import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKeyRing, derivePublicPem, generateKeypair } from '@adgate/core';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ADVERTISER_DOMAIN,
  ADVERTISER_ID,
  ADVERTISER_NAME,
  attestRecord,
  insertEvent,
  OTHER_ADVERTISER_DOMAIN,
  OTHER_ADVERTISER_ID,
  OTHER_ADVERTISER_NAME,
  OTHER_CREATIVE_ID,
  OTHER_HEADLINE,
  seedAuditChain,
  type SeededAuditChain,
  type SeedTurn,
} from './audit-seed';
import { ADMIN_SCOPE } from './app-scope';
import { createReadOnlyDb, type DashboardDb, type DashboardDbHandle } from './db';
import { createWriteDb, type DashboardWriteDbHandle } from './db-write';
import { advertisersWithReportQuery } from './metrics-queries';
import { truncateAll } from './metrics-seed';
import {
  metricsTestDatabaseUrl,
  openSeedClient,
  prepareMetricsTestDatabase,
} from './metrics-test-db';
import type { ReportAdvertiser } from './report';
import { generateReport, loadReportBundle } from './report-generate';
import { getReport } from './report-queries';
import { createReportWriter } from './report-store';

/**
 * THE REPORT AGAINST A REAL DATABASE, AND THE BUNDLE AGAINST NOTHING AT ALL.
 *
 * Every record here is genuinely built with core's buildAuditRecord, signed and chained the way
 * packages/gateway/src/evaluate/audit-store.ts chains them (lib/audit-seed.ts), so the numbers
 * come out of the same pipeline an operator's would and the verification results are real.
 *
 * The claim this file exists for is the story's second criterion: THE JSON BUNDLE RE-VERIFIES
 * OFFLINE. It is proved the only way it can be - a bundle is generated, written to a temp file,
 * and scripts/verify-bundle.ts is run against it in a separate process with tsx, no database
 * handle and no network - and then proved again in the negative: a record edited underneath the
 * dashboard makes the same script report FAIL, so a passing run means something.
 */

const url = metricsTestDatabaseUrl();
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const repoRoot = resolve(packageRoot, '..', '..');
const SCRIPT = join(packageRoot, 'scripts', 'verify-bundle.ts');
const TSX = join(repoRoot, 'node_modules', '.bin', 'tsx');

let handle: DashboardDbHandle;
let writeHandle: DashboardWriteDbHandle;
let db: DashboardDb;
let seed: Sql;
let tempDir: string;

const ADVERTISER: ReportAdvertiser = {
  id: ADVERTISER_ID,
  name: ADVERTISER_NAME,
  domain: ADVERTISER_DOMAIN,
};

beforeAll(async () => {
  await prepareMetricsTestDatabase(url);
  seed = openSeedClient(url);
  handle = createReadOnlyDb(url);
  writeHandle = createWriteDb(url);
  db = handle.db;
  tempDir = mkdtempSync(join(tmpdir(), 'adgate-bundle-'));
}, 120_000);

afterAll(async () => {
  await seed?.end({ timeout: 5 });
  await handle?.close();
  await writeHandle?.close();
  if (tempDir !== undefined) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  await truncateAll(seed);
});

/** The whole of time, so a fixture's own timestamps decide what is in range. */
const SINCE = new Date('2020-01-01T00:00:00.000Z');
const UNTIL = new Date('2040-01-01T00:00:00.000Z');

/**
 * A REALISTIC CHAIN: the reported advertiser's three serves (seq 2, 3 and 6) are interleaved
 * with a COMPETITOR's (seq 1, 4 and 8), because that is what one app's chain looks like - every
 * advertiser it served, in one sequence. Every reported record's positional predecessor here
 * belongs to somebody else, which is the case the bundle must not leak.
 */
const TURNS: SeedTurn[] = [
  'serve_other',
  'serve',
  'serve',
  'serve_other',
  { suppress: 'sensitive_category:health' },
  'serve',
  'no_fill',
  'serve_other',
];

/** The 0-based positions of the reported advertiser's serves in TURNS. */
const SERVE_POSITIONS = [1, 2, 5];
/** The same, as chain seq numbers (1-based), for attestRecord. */
const SERVE_SEQS = SERVE_POSITIONS.map((position) => position + 1);

/**
 * Three served turns for the advertiser (plus a competitor's serves, a suppression and a no_fill
 * that are not theirs), with an impression on each serve and one click, and `attestSeqs` of them
 * attested.
 */
const seedTraffic = async (attestSeqs: readonly number[]): Promise<SeededAuditChain> => {
  const chain = await seedAuditChain(seed, {
    turns: TURNS,
    appName: 'Report fixture app',
    start: new Date('2026-06-01T00:00:00.000Z'),
  });
  const serves = SERVE_POSITIONS.map((index) => chain.records[index]!);
  for (const [index, record] of serves.entries()) {
    await insertEvent(seed, chain.appId, record.id, 'impression');
    if (index === 0) {
      await insertEvent(seed, chain.appId, record.id, 'click');
    }
  }
  for (const seq of attestSeqs) {
    await attestRecord(seed, chain, seq, new Date('2026-06-02T00:00:00.000Z'));
  }
  return chain;
};

const generate = async (chain: SeededAuditChain) =>
  generateReport(
    {
      advertiser: ADVERTISER,
      since: SINCE,
      until: UNTIL,
      // The operator shape: every app, and a report with no owner.
      appIds: null,
      ownerUserId: null,
      now: new Date('2026-06-03T00:00:00.000Z'),
    },
    createReportWriter(writeHandle.db),
    { db, keys: chain.keys },
  );

/** Runs scripts/verify-bundle.ts on a file. No database, no network: a separate tsx process. */
const runVerifyBundle = (
  path: string,
  args: readonly string[] = [],
): { output: string; code: number } => {
  try {
    return {
      output: execFileSync(TSX, [SCRIPT, path, ...args], { encoding: 'utf8', cwd: packageRoot }),
      code: 0,
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      code: failure.status ?? -1,
    };
  }
};

/** The record_hash of the newest reported record: the one the tamper test rewrites. */
const newestRecordHash = (chain: SeededAuditChain): string =>
  chain.records[chain.records.length - 1]!.record_hash;

const writeBundle = (name: string, bundle: unknown): string => {
  const path = join(tempDir, name);
  writeFileSync(path, JSON.stringify(bundle, null, 2), 'utf8');
  return path;
};

describe('generating a report', () => {
  it('counts the advertiser turns, once each, from the signed records', async () => {
    // The advertiser's first serve is attested, the other two are not. Attestation writes a
    // SECOND row for that turn, so the count is the test of "is_latest": three turns, not four.
    // The competitor's three serves are in the same chain and in nobody's report but their own.
    const chain = await seedTraffic([SERVE_SEQS[0]!]);
    const { document } = await generate(chain);

    expect(document.totals.records).toBe(3);
    expect(document.totals.serves).toBe(3);
    expect(document.totals.unreadable_records).toBe(0);
    expect(document.totals.impressions).toBe(3);
    expect(document.totals.clicks).toBe(1);
    expect(document.totals.ctr).toBeCloseTo(1 / 3, 12);

    expect(document.by_app).toHaveLength(1);
    expect(document.by_app[0]).toMatchObject({
      app_id: chain.appId,
      app_name: 'Report fixture app',
      records: 3,
      serves: 3,
      impressions: 3,
      clicks: 1,
    });

    expect(document.category_distribution).toEqual({
      records: 3,
      categories: [{ category: 'software.devtools.database', records: 3, share: 1 }],
    });
    // The sensitive turn was SUPPRESSED, so no ad of this advertiser was exposed to it.
    expect(document.sensitive_exposures).toEqual({ records: 0, healthy: true, categories: [] });
    expect(document.disclosure_compliance).toEqual({ passing: 3, total: 3, rate: 1 });
    // One of the three serves was attested.
    expect(document.separation_attestation).toEqual({ passing: 1, total: 3, rate: 1 / 3 });
    expect(document.chain_integrity.status).toBe('all');
    expect(document.chain_integrity.verified).toBe(3);
    expect(document.truncated).toBe(false);
  });

  it('stores the document under a rep_ id and moves the advertisers-with-report metric', async () => {
    const chain = await seedTraffic([SERVE_SEQS[0]!]);

    const [before] = await advertisersWithReportQuery(db, ADMIN_SCOPE);
    expect(before?.total).toBe(0);

    const { id, document } = await generate(chain);
    expect(id).toMatch(/^rep_[0-9A-HJKMNP-TV-Z]{26}$/);

    // The /apps header number is this query; a generated report has to land in it.
    const [after] = await advertisersWithReportQuery(db, ADMIN_SCOPE);
    expect(after?.total).toBe(1);

    const stored = await getReport(ADMIN_SCOPE, id, db);
    expect(stored).not.toBeNull();
    expect(stored?.advertiserId).toBe(ADVERTISER_ID);
    expect(stored?.advertiserName).toBe(ADVERTISER_NAME);
    expect(stored?.document).toEqual(document);
    expect(stored?.periodStart.toISOString()).toBe(SINCE.toISOString());
    expect(stored?.periodEnd.toISOString()).toBe(UNTIL.toISOString());
  });

  it('reports a period with no traffic as empty rather than perfect', async () => {
    const chain = await seedTraffic([]);
    const { document } = await generateReport(
      {
        advertiser: ADVERTISER,
        // A month with records neither side of it: the range filter is doing the work.
        since: new Date('2019-01-01T00:00:00.000Z'),
        until: new Date('2019-02-01T00:00:00.000Z'),
        appIds: null,
        ownerUserId: null,
      },
      createReportWriter(writeHandle.db),
      { db, keys: chain.keys },
    );
    expect(document.totals.records).toBe(0);
    expect(document.chain_integrity.status).toBe('empty');
    expect(document.disclosure_compliance.rate).toBeNull();
    expect(document.sensitive_exposures.healthy).toBe(true);
  });
});

describe('the JSON bundle', () => {
  it('re-verifies offline with packages/core, in a process with no database', async () => {
    // Every serve is attested, so every reported record satisfies all EIGHT docs/audit.md
    // checks and "every record valid" is a claim with no asterisk.
    const chain = await seedTraffic(SERVE_SEQS);
    const { id } = await generate(chain);
    const stored = await getReport(ADMIN_SCOPE, id, db);
    const bundle = await loadReportBundle(stored!, null, { db, keys: chain.keys });

    expect(bundle.records).toHaveLength(3);
    expect(bundle.records.every((record) => record.is_latest)).toBe(true);
    // The neighbours the checks read: each record's predecessor and the version it supersedes.
    expect(bundle.supporting_records.length).toBeGreaterThanOrEqual(4);
    expect(bundle.creatives).toHaveLength(1);
    expect(Object.keys(bundle.public_keys)).toEqual([chain.signing.key_id]);
    expect(bundle.public_keys[chain.signing.key_id]).toContain('BEGIN PUBLIC KEY');
    // The bundle never carries a private key.
    expect(JSON.stringify(bundle)).not.toContain('PRIVATE KEY');

    const { output, code } = runVerifyBundle(writeBundle('valid.json', bundle));
    expect(output).toContain('verified 3 of 3 records');
    expect(output).toContain('RESULT: PASS');
    expect(output).not.toContain('FAILED');
    expect(code).toBe(0);
  });

  it('fails offline when a record was edited after the report was generated', async () => {
    const chain = await seedTraffic(SERVE_SEQS);
    const { id } = await generate(chain);
    const stored = await getReport(ADMIN_SCOPE, id, db);

    // The exact attack the hash chain exists to catch, applied underneath the dashboard.
    const target = newestRecordHash(chain);
    await seed`
      update audit_records
      set record = jsonb_set(record, '{classification,commercial_intent}', '0.01'::jsonb)
      where record_hash = ${target}
    `;

    const bundle = await loadReportBundle(stored!, null, { db, keys: chain.keys });
    const { output, code } = runVerifyBundle(writeBundle('tampered.json', bundle));
    expect(output).toContain('verified 2 of 3 records');
    expect(output).toContain('RESULT: FAIL');
    expect(output).toContain('record_hash');
    expect(code).toBe(1);
  });

  it('refuses a file that is not a bundle', () => {
    const { output, code } = runVerifyBundle(writeBundle('junk.json', { hello: 'world' }));
    expect(output).toContain('is not an adgate report bundle');
    expect(code).toBe(2);
  });

  /**
   * THE LEAK THIS SHAPE EXISTS TO CATCH. Every reported record's positional predecessor in this
   * chain belongs to the COMPETITOR, and a bundle that shipped those as full signed documents
   * would hand this advertiser the other one's creative, name, domain and the categories of the
   * turns it ran on. They are carried as chain references instead - and the offline verifier
   * still says every record is valid, which is the whole point: nothing was dropped, only
   * reduced to what checkChain reads.
   */
  it('carries nothing of the other advertiser in the same chain, and still verifies', async () => {
    const chain = await seedTraffic(SERVE_SEQS);
    const { id } = await generate(chain);
    const stored = await getReport(ADMIN_SCOPE, id, db);
    const bundle = await loadReportBundle(stored!, null, { db, keys: chain.keys });

    const serialized = JSON.stringify(bundle);
    for (const secret of [
      OTHER_CREATIVE_ID,
      OTHER_ADVERTISER_ID,
      OTHER_ADVERTISER_NAME,
      OTHER_ADVERTISER_DOMAIN,
      OTHER_HEADLINE,
      'shopping.sportswear',
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }

    const references = bundle.supporting_records.filter((entry) => entry.redacted === true);
    expect(references.length).toBeGreaterThan(0);
    for (const entry of references) {
      expect(entry.record).toEqual({ record_hash: entry.record_hash, app_id: entry.app_id });
    }

    const { output, code } = runVerifyBundle(writeBundle('mixed.json', bundle));
    expect(output).toContain('verified 3 of 3 records');
    expect(output).toContain('RESULT: PASS');
    expect(code).toBe(0);
  });

  it('dates the claim and the evidence separately', async () => {
    const chain = await seedTraffic(SERVE_SEQS);
    const { id } = await generate(chain);
    const stored = await getReport(ADMIN_SCOPE, id, db);
    const collectedAt = new Date('2026-07-15T09:30:00.000Z');
    const bundle = await loadReportBundle(stored!, null, {
      db,
      keys: chain.keys,
      now: collectedAt,
    });

    // generated_at is the stored report's; collected_at is this download, days later.
    expect(bundle.generated_at).toBe(stored!.createdAt.toISOString());
    expect(bundle.collected_at).toBe(collectedAt.toISOString());
    expect(bundle.collected_at).not.toBe(bundle.generated_at);
  });

  it('warns that it authenticated itself, unless it is given the keys', async () => {
    const chain = await seedTraffic(SERVE_SEQS);
    const { id } = await generate(chain);
    const stored = await getReport(ADMIN_SCOPE, id, db);
    const bundle = await loadReportBundle(stored!, null, { db, keys: chain.keys });
    const path = writeBundle('selfsigned.json', bundle);

    const alone = runVerifyBundle(path);
    expect(alone.output).toContain('WARNING');
    expect(alone.output).toContain('not that adgate signed it');

    const keysPath = writeBundle('public-keys.json', chain.keys.pems);
    const withKeys = runVerifyBundle(path, ['--keys', keysPath]);
    expect(withKeys.output).not.toContain('WARNING');
    expect(withKeys.output).toContain(`from ${keysPath}`);
    expect(withKeys.output).toContain('RESULT: PASS');
    expect(withKeys.code).toBe(0);

    // The same file against somebody else's key list is exactly what --keys is for.
    const stranger = generateKeypair();
    const wrongPath = writeBundle('other-keys.json', {
      [chain.signing.key_id]: derivePublicPem(stranger.private_pem),
    });
    const wrong = runVerifyBundle(path, ['--keys', wrongPath]);
    expect(wrong.output).toContain('is NOT the one in the expected key list');
    expect(wrong.output).toContain('RESULT: FAIL');
    expect(wrong.code).toBe(1);
  });
});

describe('a dashboard with no verification keys', () => {
  /**
   * The honest failure. With an empty ring every record fails `signature`, so the report reads
   * BROKEN - for a reason that is about this deployment's configuration and not about the
   * records. Generation goes ahead (refusing would leave the operator with nothing at all) and
   * the DOCUMENT says why, so the caveat travels with a report that gets forwarded.
   */
  it('generates the report and records that the signatures could not be checked', async () => {
    await seedTraffic(SERVE_SEQS);
    const issue = 'no verification keys are configured: set ADGATE_PUBLIC_KEYS_JSON';
    const { document } = await generateReport(
      {
        advertiser: ADVERTISER,
        since: SINCE,
        until: UNTIL,
        now: new Date('2026-06-03T00:00:00.000Z'),
        appIds: null,
        ownerUserId: null,
      },
      createReportWriter(writeHandle.db),
      { db, keys: { ring: createKeyRing({}), issue, pems: {} } },
    );

    expect(document.verifier).toEqual({ key_source: 'none', issue });
    expect(document.totals.records).toBe(3);
    expect(document.chain_integrity.status).toBe('none');
    // `signature` on every record, and `supersedes` with it: the recursive verification of the
    // superseded version runs against the same empty ring, so it cannot pass either.
    expect(document.chain_integrity.failed_checks).toContain('signature');
    expect(document.chain_integrity.failures[0]?.checks).toContain('signature');
  });

  it('says nothing is wrong when the keys are there', async () => {
    const chain = await seedTraffic(SERVE_SEQS);
    const { document } = await generate(chain);
    expect(document.verifier).toEqual({ key_source: 'environment', issue: null });
  });
});
