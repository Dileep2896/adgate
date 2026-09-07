import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ALL_APPS,
  ANY_DECISION,
  ANY_REASON,
  type AuditCursor,
  type AuditFilters,
  AUDIT_PAGE_SIZE,
} from './audit-filters';
import { type AuditPageRow, listAuditPage, listAuditReasons } from './audit-queries';
import { ADMIN_SCOPE } from './app-scope';
import { seedAuditVolume } from './audit-volume-seed';
import { createReadOnlyDb, type DashboardDb, type DashboardDbHandle } from './db';
import { truncateAll } from './metrics-seed';
// The dashboard's own test database (S32): `<DATABASE_URL_TEST>_dashboard`.
import {
  metricsTestDatabaseUrl,
  openSeedClient,
  prepareMetricsTestDatabase,
} from './metrics-test-db';

/**
 * PAGING PAST A THOUSAND RECORDS.
 *
 * 1 200 audit records for one app, in groups that SHARE a timestamp, then every page is walked
 * from the newest to the oldest through the Next links the page renders. Three things must
 * hold and all three are asserted: no record is seen twice, no record is missed, and the walk
 * adds up to exactly 1 200. Groups sharing a ts are what makes this a real test - a cursor on
 * ts alone silently loses or repeats rows at a page boundary inside such a group.
 *
 * The walk is then done backwards from the last page through the Previous links, which must
 * reconstruct the same 1 200 records in the same order.
 *
 * The QUERY PLAN is asserted where the planner has enough rows for a plan to mean anything:
 * lib/metrics-queries.integration.test.ts EXPLAINs this same query against its 10 000 record,
 * 51 app fixture and fails on a Seq Scan of audit_records.
 */

const url = metricsTestDatabaseUrl();

const RECORDS = 1_200;
/** Records sharing one ts. 1 200 / 30 = 40 distinct timestamps, so 24 pages of 50 straddle them. */
const PER_TIMESTAMP = 30;
const START = new Date('2026-06-01T00:00:00.000Z');

let handle: DashboardDbHandle;
let db: DashboardDb;
let seed: Sql;
let appId: string;

beforeAll(async () => {
  await prepareMetricsTestDatabase(url);
  seed = openSeedClient(url);
  await truncateAll(seed);
  ({ appId } = await seedAuditVolume(seed, {
    count: RECORDS,
    perTimestamp: PER_TIMESTAMP,
    start: START,
  }));
  handle = createReadOnlyDb(url);
  db = handle.db;
}, 120_000);

afterAll(async () => {
  await seed?.end({ timeout: 5 });
  await handle?.close();
});

/** The whole range the fixture covers: 40 hours from START, so two UTC days. */
const filtersFor = (patch: Partial<AuditFilters> = {}): AuditFilters => ({
  appId,
  from: '2026-06-01',
  to: '2026-06-03',
  decision: ANY_DECISION,
  reason: ANY_REASON,
  ...patch,
});

interface Walk {
  rows: AuditPageRow[];
  pages: number;
}

/** Follows the Next link from the first page to the last, exactly as an operator clicking would. */
const walkOlder = async (filters: AuditFilters): Promise<Walk> => {
  const rows: AuditPageRow[] = [];
  let cursor: AuditCursor | null = null;
  let pages = 0;
  for (;;) {
    const page = await listAuditPage(ADMIN_SCOPE, filters, cursor, db);
    rows.push(...page.rows);
    pages += 1;
    if (page.older === null) {
      expect(page.rows.length, 'the last page must not be empty').toBeGreaterThan(0);
      return { rows, pages };
    }
    cursor = page.older;
    expect(pages, 'the walk must terminate').toBeLessThan(200);
  }
};

/** Follows the Previous link from a page back to the newest one. */
const walkNewer = async (filters: AuditFilters, from: AuditCursor): Promise<Walk> => {
  const pagesOfRows: AuditPageRow[][] = [];
  let cursor: AuditCursor | null = from;
  let pages = 0;
  while (cursor !== null) {
    const page: Awaited<ReturnType<typeof listAuditPage>> = await listAuditPage(
      ADMIN_SCOPE,
      filters,
      cursor,
      db,
    );
    pagesOfRows.unshift(page.rows);
    pages += 1;
    cursor = page.newer;
    expect(pages, 'the walk must terminate').toBeLessThan(200);
  }
  return { rows: pagesOfRows.flat(), pages };
};

const hashesOf = (rows: readonly AuditPageRow[]): string[] => rows.map((row) => row.recordHash);

/** Every record the fixture wrote, in the order the search must return them. */
const expectedOrder = async (): Promise<string[]> => {
  const rows = await seed<{ record_hash: string }[]>`
    select record_hash from audit_records
    where app_id = ${appId}
    order by ts desc, record_hash desc
  `;
  return rows.map((row) => row.record_hash);
};

describe('paging through 1 200 records', () => {
  it('seeded the volume the test claims', async () => {
    const [row] = await seed<{ n: number }[]>`
      select count(*)::int as n from audit_records where app_id = ${appId}
    `;
    expect(row?.n).toBe(RECORDS);
    const [distinct] = await seed<{ n: number }[]>`
      select count(distinct ts)::int as n from audit_records where app_id = ${appId}
    `;
    expect(distinct?.n).toBe(RECORDS / PER_TIMESTAMP);
  });

  it('sees every record exactly once, in order, walking Next to the end', async () => {
    const walk = await walkOlder(filtersFor());
    const hashes = hashesOf(walk.rows);

    expect(walk.rows).toHaveLength(RECORDS);
    expect(new Set(hashes).size, 'no record may appear on two pages').toBe(RECORDS);
    expect(hashes).toEqual(await expectedOrder());
    expect(walk.pages).toBe(Math.ceil(RECORDS / AUDIT_PAGE_SIZE));
  });

  it('is strictly descending across page boundaries, ties included', async () => {
    const { rows } = await walkOlder(filtersFor());
    for (let index = 1; index < rows.length; index += 1) {
      const before = rows[index - 1]!;
      const current = rows[index]!;
      const ordered =
        before.ts.getTime() > current.ts.getTime() ||
        (before.ts.getTime() === current.ts.getTime() && before.recordHash > current.recordHash);
      expect(ordered, `row ${index} is out of order`).toBe(true);
    }
  });

  it('reconstructs the same records walking Previous back to the first page', async () => {
    const forward = await walkOlder(filtersFor());
    // Stand on the last page and click Previous until there is no Previous left.
    let cursor: AuditCursor | null = null;
    let last = await listAuditPage(ADMIN_SCOPE, filtersFor(), cursor, db);
    while (last.older !== null) {
      cursor = last.older;
      last = await listAuditPage(ADMIN_SCOPE, filtersFor(), cursor, db);
    }
    expect(last.newer).not.toBeNull();

    const back = await walkNewer(filtersFor(), last.newer!);
    const rows = [...back.rows, ...last.rows];
    expect(hashesOf(rows)).toEqual(hashesOf(forward.rows));
  });

  it('never returns a partial page except the last one', async () => {
    let cursor: AuditCursor | null = null;
    for (;;) {
      const page = await listAuditPage(ADMIN_SCOPE, filtersFor(), cursor, db);
      if (page.older === null) {
        expect(page.rows.length).toBeLessThanOrEqual(AUDIT_PAGE_SIZE);
        return;
      }
      expect(page.rows).toHaveLength(AUDIT_PAGE_SIZE);
      cursor = page.older;
    }
  });
});

describe('the filters over the same volume', () => {
  it('narrows to one decision and still pages correctly', async () => {
    const walk = await walkOlder(filtersFor({ decision: 'suppress' }));
    expect(walk.rows).toHaveLength((RECORDS / 4) * 3);
    expect(new Set(hashesOf(walk.rows)).size).toBe(walk.rows.length);
    expect(walk.rows.every((row) => row.decision === 'suppress')).toBe(true);
  });

  it('narrows to one reason, sensitive categories included', async () => {
    const walk = await walkOlder(filtersFor({ reason: 'sensitive_category:health' }));
    expect(walk.rows).toHaveLength(RECORDS / 4);
    expect(walk.rows.every((row) => row.reason === 'sensitive_category:health')).toBe(true);
  });

  it('offers exactly the reasons the records carry', async () => {
    expect(await listAuditReasons(ADMIN_SCOPE, filtersFor(), db)).toEqual([
      'no_fill',
      'paid_user',
      'sensitive_category:health',
    ]);
  });

  it('excludes everything outside the date range', async () => {
    const empty = await listAuditPage(
      ADMIN_SCOPE,
      filtersFor({ from: '2020-01-01', to: '2020-01-02' }),
      null,
      db,
    );
    expect(empty.rows).toEqual([]);
    expect(empty.older).toBeNull();
    expect(empty.newer).toBeNull();
  });

  it('gives the same first page with no app selected, through the lateral over every app', async () => {
    const scoped = await listAuditPage(ADMIN_SCOPE, filtersFor(), null, db);
    const global = await listAuditPage(ADMIN_SCOPE, filtersFor({ appId: ALL_APPS }), null, db);
    expect(hashesOf(global.rows)).toEqual(hashesOf(scoped.rows));
    expect(global.rows[0]?.appName).toBe('Audit volume app');
  });
});
