import type { Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadAuditDetail } from './audit-detail';
import {
  ADVERTISER_DOMAIN,
  ADVERTISER_ID,
  ADVERTISER_NAME,
  seedAuditChain,
  type SeededAuditChain,
  type SeedTurn,
} from './audit-seed';
import { ADMIN_SCOPE } from './app-scope';
import { createReadOnlyDb, type DashboardDb, type DashboardDbHandle } from './db';
import { truncateAll } from './metrics-seed';
import {
  metricsTestDatabaseUrl,
  openSeedClient,
  prepareMetricsTestDatabase,
} from './metrics-test-db';
import type { ReportAdvertiser } from './report';
import { generateReport } from './report-generate';
import type { ReportWriter } from './report-store';
import { prunedThrough } from './retention-seed';

/**
 * WHAT /audit/[id] AND A VERIFICATION REPORT SAY ABOUT A PRUNED CHAIN.
 *
 * The retention job shortens an app's chain from the oldest end, so the oldest surviving record
 * has no predecessor row. Both of the dashboard's verifying surfaces read the watermark through
 * the gateway's own buildVerifyContext, so both must call that `chain` ok with detail 'pruned'
 * rather than a broken chain - and both must go on failing 'previous record missing' for a
 * record that went missing any other way. An operator who could not tell those two apart would
 * have no reason to trust either verdict.
 */

const url = metricsTestDatabaseUrl();
const CUTOFF = new Date('2026-05-02T00:00:00.000Z');
/** The chain starts after the cutoff, so every surviving record legitimately post-dates it. */
const CHAIN_START = new Date('2026-05-10T09:00:00.000Z');
const SUPPRESS: SeedTurn = { suppress: 'sensitive_category:health' };
const ADVERTISER: ReportAdvertiser = {
  id: ADVERTISER_ID,
  name: ADVERTISER_NAME,
  domain: ADVERTISER_DOMAIN,
};

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

/** Six suppress turns: unattested, so an untouched one passes all eight checks. */
const chainOf = async (): Promise<SeededAuditChain> =>
  seedAuditChain(seed, {
    turns: [SUPPRESS, SUPPRESS, SUPPRESS, SUPPRESS, SUPPRESS, SUPPRESS],
    start: CHAIN_START,
  });

/** The same chain with the advertiser's serve at seq 4: the first record retention keeps. */
const chainWithServeAtFour = async (): Promise<SeededAuditChain> =>
  seedAuditChain(seed, {
    turns: [SUPPRESS, SUPPRESS, SUPPRESS, 'serve', SUPPRESS, SUPPRESS],
    start: CHAIN_START,
  });

const detailAt = async (chain: SeededAuditChain, seq: number) => {
  const record = chain.records[seq - 1];
  if (record === undefined) {
    throw new Error(`no record at seq ${seq}`);
  }
  const detail = await loadAuditDetail(
    { auditId: record.id, version: record.record_hash, scope: ADMIN_SCOPE },
    { db, keys: chain.keys },
  );
  if (detail === null) {
    throw new Error(`the detail page found no record for ${record.id}`);
  }
  return detail;
};

const chainCheck = (checks: { name: string; ok: boolean; detail: string }[]) => {
  const found = checks.find((check) => check.name === 'chain');
  if (found === undefined) {
    throw new Error('no chain check');
  }
  return { ok: found.ok, detail: found.detail };
};

describe('the audit detail page after retention pruned the oldest records', () => {
  it('reports the oldest surviving record as chain ok with detail pruned', async () => {
    const chain = await chainOf();
    await prunedThrough(seed, { appId: chain.appId, throughSeq: 3, cutoff: CUTOFF });

    const detail = await detailAt(chain, 4);

    expect(chainCheck(detail.verification.checks)).toEqual({ ok: true, detail: 'pruned' });
    expect(detail.verification.failed).toEqual([]);
    expect(detail.previous).toBeNull();
  });

  it('leaves the records above it verifying against their real predecessors', async () => {
    const chain = await chainOf();
    await prunedThrough(seed, { appId: chain.appId, throughSeq: 3, cutoff: CUTOFF });

    const detail = await detailAt(chain, 5);

    expect(chainCheck(detail.verification.checks)).toEqual({ ok: true, detail: '' });
    expect(detail.previous?.seq).toBe(4);
    expect(detail.verification.failed).toEqual([]);
  });

  it('still fails previous_missing for a record deleted above the watermark', async () => {
    const chain = await chainOf();
    await prunedThrough(seed, { appId: chain.appId, throughSeq: 3, cutoff: CUTOFF });
    await seed`delete from audit_records where app_id = ${chain.appId} and seq = 5`;

    const detail = await detailAt(chain, 6);

    expect(chainCheck(detail.verification.checks)).toEqual({
      ok: false,
      detail: 'previous record missing',
    });
    expect(detail.verification.failed).toEqual(['chain']);
  });

  it('fails previous_missing when the app has no watermark at all', async () => {
    const chain = await chainOf();
    await seed`delete from audit_records where app_id = ${chain.appId} and seq = 3`;

    const detail = await detailAt(chain, 4);

    expect(chainCheck(detail.verification.checks)).toEqual({
      ok: false,
      detail: 'previous record missing',
    });
  });
});

describe('a verification report over a pruned chain', () => {
  it('grades the oldest surviving record as chain-intact, not broken', async () => {
    const chain = await chainWithServeAtFour();
    await prunedThrough(seed, { appId: chain.appId, throughSeq: 3, cutoff: CUTOFF });
    const writer: ReportWriter = { save: async () => 'rep_test' };

    const { document } = await generateReport(
      {
        advertiser: ADVERTISER,
        since: new Date('2026-05-01T00:00:00.000Z'),
        until: new Date('2026-06-01T00:00:00.000Z'),
        now: new Date('2026-06-01T00:00:00.000Z'),
        appIds: null,
        ownerUserId: null,
      },
      writer,
      { db, keys: chain.keys },
    );

    // The serve at seq 4 is the advertiser's only record and its predecessor was pruned.
    expect(document.totals.records).toBe(1);
    expect(document.chain_integrity).toMatchObject({
      status: 'all',
      verified: 1,
      failed: 0,
      failed_checks: [],
      failures: [],
    });
  });
});
