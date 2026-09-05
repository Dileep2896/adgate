import { sql, type SQLWrapper } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ALL_APPS,
  ANY_DECISION,
  ANY_REASON,
  type AuditCursor,
  type AuditFilters,
  AUDIT_PAGE_SIZE,
  utcDay,
} from './audit-filters';
import { auditPageQuery, auditReasonsQuery } from './audit-queries';
import { createReadOnlyDb, type DashboardDb, type DashboardDbHandle } from './db';
import { computeMetrics, computeGlobalMetrics, metricsWindow, suppressBreakdown } from './metrics';
import {
  advertisersWithReportQuery,
  appDecisionCounts,
  appDecisionCountsQuery,
  appEventCounts,
  appEventCountsQuery,
  appsIntegratedQuery,
  defaultMetricsWindow,
  globalDecisionCountsQuery,
  globalEventCountsQuery,
  globalMetricRows,
} from './metrics-queries';
import {
  BULK_APP_ID,
  BULK_APPS,
  FIXTURE_ADVERTISER_ID,
  FIXTURE_APP_ID,
  seedMetricsFixture,
  seedReport,
} from './metrics-seed';
import {
  metricsTestDatabaseUrl,
  openSeedClient,
  prepareMetricsTestDatabase,
} from './metrics-test-db';
import { type ReportRange, reportEventCountsQuery, reportRecordsQuery } from './report-queries';

/**
 * The metric queries against a real Postgres, for the two things a unit test cannot check:
 *
 * 1. THE PLAN. audit_records holds the signed chain and is the table that grows; a dashboard
 *    page must never read it whole. Every query is EXPLAINed against 10 000 seeded records and
 *    must reach audit_records through an index, never a Seq Scan. This is the test that fails
 *    when someone drops the app_id filter from a query "just for the global view".
 * 2. THE SQL. That the grouped rows Postgres returns really are the shape lib/metrics.ts
 *    computes from, with the hand written app's numbers coming out as computed by hand.
 *
 * S35 added the two report queries. A verification report is "every record referencing this
 * advertiser's creatives between two dates", which audit_records_advertiser_id_ts_idx covers
 * exactly; the assertion by index NAME below is what stops that filter from quietly becoming a
 * post-scan filter.
 *
 * S34 added the /audit search to the plan list. It reads the same table under the same rule,
 * and it is the query most likely to lose the index: it has no GROUP BY to hold the lateral
 * down (an ORDER BY ... LIMIT does that instead) and it is the one an operator runs with no app
 * selected. Its correctness - no row seen twice, none skipped, past 1 000 records - is
 * lib/audit-pagination.integration.test.ts; its PLAN is here, where the fixture is big enough
 * for a plan to mean anything.
 */

const url = metricsTestDatabaseUrl();
const WINDOW = defaultMetricsWindow();

let handle: DashboardDbHandle;
let db: DashboardDb;
let seed: Sql;

beforeAll(async () => {
  await prepareMetricsTestDatabase(url);
  seed = openSeedClient(url);
  await seedMetricsFixture(seed);
  handle = createReadOnlyDb(url);
  db = handle.db;
}, 120_000);

afterAll(async () => {
  await seed?.end({ timeout: 5 });
  await handle?.close();
});

/** The plan of a query, as one string. EXPLAIN only: nothing is executed. */
const planOf = async (query: SQLWrapper): Promise<string> => {
  const rows = await db.execute<{ 'QUERY PLAN': string }>(sql`explain ${query.getSQL()}`);
  return [...rows].map((row) => row['QUERY PLAN']).join('\n');
};

/** The whole span the bulk fixture covers (400 days back), as the /audit filters express it. */
const auditFilters = (patch: Partial<AuditFilters> = {}): AuditFilters => ({
  appId: BULK_APP_ID,
  from: utcDay(new Date(Date.now() - 500 * 24 * 60 * 60 * 1000)),
  to: utcDay(new Date()),
  decision: ANY_DECISION,
  reason: ANY_REASON,
  ...patch,
});

/** Deep in the result set: the page an OFFSET based search would be slowest on. */
const DEEP_CURSOR: AuditCursor = {
  direction: 'older',
  ts: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
  recordHash: `sha256:${'5'.repeat(64)}`,
};

/** The whole seeded span for the advertiser every serve in the fixture points at. */
const REPORT_RANGE: ReportRange = {
  advertiserId: FIXTURE_ADVERTISER_ID,
  since: new Date(Date.now() - 500 * 24 * 60 * 60 * 1000),
  until: new Date(Date.now() + 24 * 60 * 60 * 1000),
};

/** Every query that reads audit_records, by name. */
const AUDIT_QUERIES: [string, (db: DashboardDb) => SQLWrapper][] = [
  ['app decision counts', (handle) => appDecisionCountsQuery(handle, BULK_APP_ID, WINDOW)],
  ['app event counts', (handle) => appEventCountsQuery(handle, BULK_APP_ID, WINDOW)],
  ['global decision counts', (handle) => globalDecisionCountsQuery(handle, WINDOW)],
  ['global event counts', (handle) => globalEventCountsQuery(handle, WINDOW)],
  ['apps integrated', (handle) => appsIntegratedQuery(handle)],
  [
    'audit search, one app',
    (handle) =>
      auditPageQuery(handle, {
        filters: auditFilters(),
        cursor: null,
        limit: AUDIT_PAGE_SIZE + 1,
      }),
  ],
  [
    'audit search, every app',
    (handle) =>
      auditPageQuery(handle, {
        filters: auditFilters({ appId: ALL_APPS }),
        cursor: null,
        limit: AUDIT_PAGE_SIZE + 1,
      }),
  ],
  [
    'audit search, deep page',
    (handle) =>
      auditPageQuery(handle, {
        filters: auditFilters({ appId: ALL_APPS, decision: 'suppress' }),
        cursor: DEEP_CURSOR,
        limit: AUDIT_PAGE_SIZE + 1,
      }),
  ],
  [
    'audit reason options',
    (handle) => auditReasonsQuery(handle, auditFilters({ appId: ALL_APPS })),
  ],
  ['report records', (handle) => reportRecordsQuery(handle, REPORT_RANGE)],
  ['report event counts', (handle) => reportEventCountsQuery(handle, REPORT_RANGE)],
];

describe('every query that touches audit_records', () => {
  for (const [name, build] of AUDIT_QUERIES) {
    it(`reads audit_records through an index: ${name}`, async () => {
      const plan = await planOf(build(db));
      expect(plan, plan).toMatch(/(Bitmap )?Index (Only )?Scan.*on audit_records/s);
      expect(plan, plan).not.toContain('Seq Scan on audit_records');
    });
  }

  it('reaches the audit search through audit_records_app_id_ts_idx by name', async () => {
    for (const appId of [BULK_APP_ID, ALL_APPS]) {
      const plan = await planOf(
        auditPageQuery(db, {
          filters: auditFilters({ appId }),
          cursor: null,
          limit: AUDIT_PAGE_SIZE + 1,
        }),
      );
      expect(plan, plan).toContain('audit_records_app_id_ts_idx');
    }
  });

  it('reaches a report through audit_records_advertiser_id_ts_idx by name', async () => {
    for (const build of [reportRecordsQuery, reportEventCountsQuery]) {
      const plan = await planOf(build(db, REPORT_RANGE));
      expect(plan, plan).toContain('audit_records_advertiser_id_ts_idx');
    }
  });

  it('reaches the events of a turn through events_audit_id_idx', async () => {
    const plan = await planOf(appEventCountsQuery(db, BULK_APP_ID, WINDOW));
    expect(plan, plan).toContain('events_audit_id_idx');
  });

  it('has enough seeded rows for the plan to mean anything', async () => {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_records`,
    );
    expect(row?.n).toBeGreaterThan(5_000);
  });
});

describe('the hand written app', () => {
  /**
   *  10 turns: 4 serve, 2 no_fill, paid_user, sensitive_category:health, frequency_cap, error.
   *  One of the serves was attested, so audit_records holds 11 rows for 10 turns.
   *
   *  eligible  4 serves + 2 no_fill = 6      -> 6/10  = 60%
   *  fill      4 / 6                                  = 66.67%
   *  CTR       1 click / 3 impressions               = 33.3%
   *  revenue   3 impressions * 20 ecpm / 1000        = 0.06
   *  RPM       0.06 / 6 * 1000                       = 10
   */
  it('counts each turn once, whatever attestation wrote', async () => {
    const decisions = await appDecisionCounts(FIXTURE_APP_ID, WINDOW, db);
    const events = await appEventCounts(FIXTURE_APP_ID, WINDOW, db);
    const metrics = computeMetrics(decisions, events);

    expect(metrics.turnsEvaluated).toBe(10);
    expect(metrics.serves).toBe(4);
    expect(metrics.adEligible).toBe(6);
    expect(metrics.eligibleRate).toBe(0.6);
    expect(metrics.fillRate).toBeCloseTo(4 / 6, 12);
    expect(metrics.impressions).toBe(3);
    expect(metrics.clicks).toBe(1);
    expect(metrics.ctr).toBeCloseTo(1 / 3, 12);
    expect(metrics.estimatedRevenue).toBeCloseTo(0.06, 12);
    expect(metrics.rpm).toBeCloseTo(10, 12);
  });

  it('groups the suppress reasons the gateway wrote', async () => {
    const decisions = await appDecisionCounts(FIXTURE_APP_ID, WINDOW, db);
    const breakdown = suppressBreakdown(decisions);
    expect(breakdown.total).toBe(6);
    expect(breakdown.sensitiveTotal).toBe(1);
    expect(Object.fromEntries(breakdown.reasons.map((row) => [row.reason, row.count]))).toEqual({
      no_fill: 2,
      paid_user: 1,
      'sensitive_category:health': 1,
      frequency_cap: 1,
      error: 1,
    });
  });

  it('returns one row per UTC day, decision and reason', async () => {
    const decisions = await appDecisionCounts(FIXTURE_APP_ID, WINDOW, db);
    for (const row of decisions) {
      expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.count).toBeGreaterThan(0);
    }
    expect(decisions.reduce((sum, row) => sum + row.count, 0)).toBe(10);
  });

  it('excludes turns older than the window', async () => {
    const empty = metricsWindow(new Date('2020-01-01T00:00:00.000Z'), 30);
    expect(await appDecisionCounts(FIXTURE_APP_ID, empty, db)).toEqual([]);
  });
});

describe('the global overview', () => {
  it('counts every integrated app and the advertisers with a report', async () => {
    const before = await globalMetricRows(WINDOW, db);
    expect(before.appsIntegrated).toBe(BULK_APPS + 1);
    expect(before.advertisersWithReport).toBe(0);

    await seedReport(seed);
    const [after] = await advertisersWithReportQuery(db);
    expect(after?.total).toBe(1);
  });

  it('adds the turns of every app together', async () => {
    const rows = await globalMetricRows(WINDOW, db);
    const global = computeGlobalMetrics(rows);
    const fixture = computeMetrics(
      await appDecisionCounts(FIXTURE_APP_ID, WINDOW, db),
      await appEventCounts(FIXTURE_APP_ID, WINDOW, db),
    );
    expect(global.turnsEvaluated).toBeGreaterThan(fixture.turnsEvaluated);
    expect(global.adEligible).toBeGreaterThan(0);
    expect(global.eligibleRate).not.toBeNull();
    expect(global.impressions).toBeGreaterThan(0);
  });
});
