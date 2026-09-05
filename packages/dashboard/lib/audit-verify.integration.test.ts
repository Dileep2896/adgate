import type { Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadAuditDetail } from './audit-detail';
import {
  attestRecord,
  CREATIVE_ID,
  seedAuditChain,
  type SeededAuditChain,
  type SeedTurn,
} from './audit-seed';
import { createReadOnlyDb, type DashboardDb, type DashboardDbHandle } from './db';
import { truncateAll } from './metrics-seed';
// The dashboard's own test database (S32): `<DATABASE_URL_TEST>_dashboard`, so the gateway's
// integration tests and this one never truncate each other's fixtures.
import {
  metricsTestDatabaseUrl,
  openSeedClient,
  prepareMetricsTestDatabase,
} from './metrics-test-db';
import { VERIFY_CHECK_COUNT, VERIFY_CHECK_NAMES } from './verify-labels';

/**
 * TAMPERING, AND WHAT THE DETAIL PAGE SAYS ABOUT IT.
 *
 * Records are written the normal way - core's buildAuditRecord, signed and chained exactly as
 * packages/gateway/src/evaluate/audit-store.ts writes them - and then edited underneath the
 * gateway with raw SQL, which is precisely the attack the hash chain exists to detect. Each
 * test then loads the data the /audit/[id] page renders (loadAuditDetail, the real function,
 * running the real core verify()) and asserts WHICH check fails, not merely that something did:
 * a verifier that fails everything whenever anything is wrong tells an operator nothing.
 */

const url = metricsTestDatabaseUrl();

let handle: DashboardDbHandle;
let db: DashboardDb;
let seed: Sql;

beforeAll(async () => {
  await prepareMetricsTestDatabase(url);
  seed = openSeedClient(url);
  handle = createReadOnlyDb(url);
  db = handle.db;
}, 120_000);

afterAll(async () => {
  await seed?.end({ timeout: 5 });
  await handle?.close();
});

beforeEach(async () => {
  await truncateAll(seed);
});

/** The verification of one stored version, through the page's own data function. */
const verifyOf = async (chain: SeededAuditChain, seq: number, version?: string) => {
  const record = chain.records[seq - 1];
  if (record === undefined) {
    throw new Error(`no record at seq ${seq}`);
  }
  const detail = await loadAuditDetail(
    { auditId: record.id, version: version ?? record.record_hash },
    { db, keys: chain.keys },
  );
  if (detail === null) {
    throw new Error(`the detail page found no record for ${record.id}`);
  }
  return detail;
};

const SUPPRESS: SeedTurn = { suppress: 'sensitive_category:health' };

describe('an untouched chain', () => {
  it('verifies a suppress record with all eight checks ok', async () => {
    const chain = await seedAuditChain(seed, { turns: [SUPPRESS, SUPPRESS, SUPPRESS] });
    const detail = await verifyOf(chain, 2);

    expect(detail.verification.valid).toBe(true);
    expect(detail.verification.failed).toEqual([]);
    expect(detail.verification.checks).toHaveLength(VERIFY_CHECK_COUNT);
    expect(detail.verification.checks.map((check) => check.name)).toEqual([...VERIFY_CHECK_NAMES]);
    for (const check of detail.verification.checks) {
      expect(check.ok, `${check.name}: ${check.detail}`).toBe(true);
      expect(check.description).not.toBe('');
    }
  });

  it('shows the chain neighbours the record sits between', async () => {
    const chain = await seedAuditChain(seed, { turns: [SUPPRESS, SUPPRESS, SUPPRESS] });
    const detail = await verifyOf(chain, 2);

    expect(detail.seq).toBe(2);
    expect(detail.previous?.recordHash).toBe(chain.records[0]?.record_hash);
    expect(detail.next?.recordHash).toBe(chain.records[2]?.record_hash);
    expect(detail.appName).toBe(chain.appName);
    expect(detail.versions).toHaveLength(1);
    expect(detail.isLatest).toBe(true);

    const first = await verifyOf(chain, 1);
    expect(first.previous).toBeNull();
    expect(first.record?.prev_hash).toBe('genesis');
  });

  it('serves the latest version when no version is asked for', async () => {
    const chain = await seedAuditChain(seed, { turns: [SUPPRESS] });
    const record = chain.records[0]!;
    const detail = await loadAuditDetail({ auditId: record.id }, { db, keys: chain.keys });
    expect(detail?.recordHash).toBe(record.record_hash);
    expect(await loadAuditDetail({ auditId: 'aud_nope' }, { db, keys: chain.keys })).toBeNull();
  });
});

describe('a record edited with SQL', () => {
  it('fails exactly the record_hash check when the classification is changed', async () => {
    const chain = await seedAuditChain(seed, { turns: [SUPPRESS, SUPPRESS, SUPPRESS] });
    const target = chain.records[1]!;
    expect((await verifyOf(chain, 2)).verification.valid).toBe(true);

    await seed`
      update audit_records
      set record = jsonb_set(record, '{classification,commercial_intent}', '0.01'::jsonb)
      where record_hash = ${target.record_hash}
    `;

    const detail = await verifyOf(chain, 2);
    expect(detail.verification.valid).toBe(false);
    expect(detail.verification.failed).toEqual(['record_hash']);
    // The signature still verifies: it signs the record_hash STRING, which was not touched.
    const signature = detail.verification.checks.find((check) => check.name === 'signature');
    expect(signature?.ok).toBe(true);
    expect(detail.record?.classification.commercial_intent).toBe(0.01);
  });

  it('fails the chain check alone when the previous record is deleted', async () => {
    const chain = await seedAuditChain(seed, { turns: [SUPPRESS, SUPPRESS, SUPPRESS] });
    await seed`delete from audit_records where record_hash = ${chain.records[0]!.record_hash}`;

    const detail = await verifyOf(chain, 2);
    expect(detail.verification.valid).toBe(false);
    expect(detail.verification.failed).toEqual(['chain']);
    expect(detail.previous).toBeNull();
    const chainCheck = detail.verification.checks.find((check) => check.name === 'chain');
    expect(chainCheck?.detail).toContain('previous record');
  });

  it('fails record_hash AND chain when prev_hash is rewritten inside the record', async () => {
    const chain = await seedAuditChain(seed, { turns: [SUPPRESS, SUPPRESS, SUPPRESS] });
    const forged = `sha256:${'b'.repeat(64)}`;
    // to_jsonb over a text parameter, NOT a JSON.stringify'd one: postgres.js binds a string
    // for a jsonb position by serialising it itself, so pre-encoding stores a quoted quote.
    await seed`
      update audit_records
      set record = jsonb_set(record, '{prev_hash}', to_jsonb(${forged}::text))
      where record_hash = ${chain.records[1]!.record_hash}
    `;

    const detail = await verifyOf(chain, 2);
    expect(detail.verification.failed).toEqual(['record_hash', 'chain']);
  });
});

describe('a creatives row edited with SQL', () => {
  it('fails the creative_hash check of the record that served it', async () => {
    const chain = await seedAuditChain(seed, { turns: ['serve', SUPPRESS] });
    // An unattested SERVE record always reports separation_attested as not attested
    // (docs/audit.md: true only if attested), so that is the baseline this test measures from.
    expect((await verifyOf(chain, 1)).verification.failed).toEqual(['separation_attested']);

    await seed`update creatives set headline = 'Rewritten after the fact' where id = ${CREATIVE_ID}`;

    const detail = await verifyOf(chain, 1);
    expect(detail.verification.valid).toBe(false);
    expect(detail.verification.failed).toEqual(['creative_hash', 'separation_attested']);
    const creativeHash = detail.verification.checks.find((c) => c.name === 'creative_hash');
    expect(creativeHash?.detail).not.toBe('');
  });

  it('fails the creative_hash check when the creatives row is gone', async () => {
    const chain = await seedAuditChain(seed, { turns: ['serve'] });
    await seed`update audit_records set creative_id = null`;
    await seed`delete from creatives where id = ${CREATIVE_ID}`;

    const detail = await verifyOf(chain, 1);
    expect(detail.verification.failed).toContain('creative_hash');
  });
});

describe('an attested turn', () => {
  it('verifies both versions and offers the switcher', async () => {
    const chain = await seedAuditChain(seed, { turns: ['serve', SUPPRESS] });
    const original = chain.records[0]!;
    const attested = await attestRecord(seed, chain, 1);

    const latest = await loadAuditDetail({ auditId: original.id }, { db, keys: chain.keys });
    expect(latest?.recordHash).toBe(attested.record_hash);
    expect(latest?.isLatest).toBe(true);
    expect(latest?.verification.failed).toEqual([]);
    expect(latest?.versions).toHaveLength(2);
    expect(latest?.superseded?.recordHash).toBe(original.record_hash);
    expect(latest?.attestRendered).toBe(true);

    const older = await loadAuditDetail(
      { auditId: original.id, version: original.record_hash },
      { db, keys: chain.keys },
    );
    expect(older?.isLatest).toBe(false);
    expect(older?.supersededBy?.recordHash).toBe(attested.record_hash);
    // The attestation proves the separation of the version it supersedes.
    expect(older?.verification.failed).toEqual([]);
  });
});

describe('the key ring', () => {
  it('fails the signature check, and says why, when no public key is configured', async () => {
    const chain = await seedAuditChain(seed, { turns: [SUPPRESS] });
    const record = chain.records[0]!;
    const { loadVerifyKeys } = await import('./verify-keys');
    const empty = loadVerifyKeys({});

    const detail = await loadAuditDetail({ auditId: record.id }, { db, keys: empty });
    expect(detail?.verification.failed).toEqual(['signature']);
    expect(detail?.verification.keyIssue).toContain('ADGATE_PUBLIC_KEYS_JSON');
  });
});
