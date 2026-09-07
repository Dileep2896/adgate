import { apps, auditRecords } from '@adgateio/gateway/schema';
import { and, asc, desc, eq, gt, gte, isNotNull, lt, lte, or, type SQL } from 'drizzle-orm';

import type { AppScope } from './app-scope';
import {
  ALL_APPS,
  ANY_DECISION,
  ANY_REASON,
  type AuditCursor,
  type AuditFilters,
  AUDIT_PAGE_SIZE,
  auditWindow,
  encodeCursor,
} from './audit-filters';
import { type DashboardDb, dashboardDb } from './db';
import { appScopeCondition } from './scope-queries';

/**
 * The SQL behind /audit. Reads only (lib/db.ts).
 *
 * TWO OBLIGATIONS, both proved by lib/audit-pagination.integration.test.ts and the EXPLAIN
 * suite in lib/metrics-queries.integration.test.ts:
 *
 * 1. NO QUERY MAY SCAN audit_records. It is the biggest table in the database and the one
 *    holding the signed chain. Every read here is filtered by (app_id, ts) and lands on
 *    audit_records_app_id_ts_idx. A search with no app selected cannot name an app, so - as in
 *    lib/metrics-queries.ts - it walks `apps` and takes one indexed slice per app with CROSS
 *    JOIN LATERAL instead of dropping the app_id filter. The lateral carries ORDER BY ... LIMIT,
 *    which (like the GROUP BY in the metrics laterals) is an optimisation fence: Postgres cannot
 *    pull it up into the outer join and fall back to reading the table whole. The union of each
 *    app's newest N rows always contains the newest N rows overall, so taking N again outside is
 *    the same answer a global sort would give.
 * 2. PAGING IS KEYSET, NOT OFFSET (see AuditCursor). The page predicate is a comparison on
 *    (ts, record_hash), which is exactly the order the rows come back in, so no row is ever
 *    shown twice or skipped, whatever is written while an operator is paging.
 */

export interface AuditPageRow {
  recordHash: string;
  id: string;
  appId: string;
  appName: string | null;
  seq: number;
  isLatest: boolean;
  decision: 'serve' | 'suppress';
  reason: string | null;
  creativeId: string | null;
  advertiserId: string | null;
  supersedesHash: string | null;
  ts: Date;
}

export interface AuditPageOptions {
  /**
   * Whose records these are. It becomes one predicate on the OUTER `apps` scan, which is the
   * same scan the `?app=` filter narrows - so a member asking for another member's app id gets
   * an empty page, exactly as they would for an app id that never existed.
   */
  scope: AppScope;
  filters: AuditFilters;
  cursor: AuditCursor | null;
  /** Rows to fetch. The page asks for one more than it shows, to know if there is a next one. */
  limit: number;
}

/** The window, decision and reason filters, plus the app_id equality that drives the index. */
const sliceConditions = (options: AuditPageOptions): SQL[] => {
  const { filters, cursor } = options;
  const window = auditWindow(filters);
  const conditions: SQL[] = [
    eq(auditRecords.appId, apps.id),
    gte(auditRecords.ts, window.since),
    lt(auditRecords.ts, window.until),
  ];
  if (filters.decision !== ANY_DECISION) {
    conditions.push(eq(auditRecords.decision, filters.decision));
  }
  if (filters.reason !== ANY_REASON) {
    conditions.push(eq(auditRecords.reason, filters.reason));
  }
  if (cursor !== null) {
    // (ts, record_hash) < (cursor) written as a bounded range plus a tie-break, so the range
    // stays usable as an index condition instead of becoming a filter over the whole window.
    const older = cursor.direction === 'older';
    conditions.push(older ? lte(auditRecords.ts, cursor.ts) : gte(auditRecords.ts, cursor.ts));
    const tie = older
      ? or(lt(auditRecords.ts, cursor.ts), lt(auditRecords.recordHash, cursor.recordHash))
      : or(gt(auditRecords.ts, cursor.ts), gt(auditRecords.recordHash, cursor.recordHash));
    if (tie !== undefined) {
      conditions.push(tie);
    }
  }
  return conditions;
};

/** One app's slice of the result, newest first (or oldest first when paging backwards). */
const pageSlice = (db: DashboardDb, options: AuditPageOptions) => {
  const older = options.cursor === null || options.cursor.direction === 'older';
  const direction = older ? desc : asc;
  return db
    .select({
      recordHash: auditRecords.recordHash,
      id: auditRecords.id,
      appId: auditRecords.appId,
      seq: auditRecords.seq,
      isLatest: auditRecords.isLatest,
      decision: auditRecords.decision,
      reason: auditRecords.reason,
      creativeId: auditRecords.creativeId,
      advertiserId: auditRecords.advertiserId,
      supersedesHash: auditRecords.supersedesHash,
      ts: auditRecords.ts,
    })
    .from(auditRecords)
    .where(and(...sliceConditions(options)))
    .orderBy(direction(auditRecords.ts), direction(auditRecords.recordHash))
    .limit(options.limit)
    .as('page');
};

/** The search query itself. Exported so the EXPLAIN test can plan it without running it. */
export const auditPageQuery = (db: DashboardDb, options: AuditPageOptions) => {
  const slice = pageSlice(db, options);
  const older = options.cursor === null || options.cursor.direction === 'older';
  const direction = older ? desc : asc;
  const base = db
    .select({
      recordHash: slice.recordHash,
      id: slice.id,
      appId: slice.appId,
      appName: apps.name,
      seq: slice.seq,
      isLatest: slice.isLatest,
      decision: slice.decision,
      reason: slice.reason,
      creativeId: slice.creativeId,
      advertiserId: slice.advertiserId,
      supersedesHash: slice.supersedesHash,
      ts: slice.ts,
    })
    .from(apps)
    .crossJoinLateral(slice);
  const owned = appScopeCondition(options.scope);
  const appFilter =
    options.filters.appId === ALL_APPS ? undefined : eq(apps.id, options.filters.appId);
  const condition = and(appFilter, owned);
  const scoped = condition === undefined ? base : base.where(condition);
  return scoped.orderBy(direction(slice.ts), direction(slice.recordHash)).limit(options.limit);
};

export interface AuditPage {
  rows: AuditPageRow[];
  /** Cursor for the page of newer records, or null when this is already the newest page. */
  newer: AuditCursor | null;
  /** Cursor for the page of older records, or null when this is the last page. */
  older: AuditCursor | null;
}

/**
 * One page of the search, newest first. Fetches pageSize + 1 rows: the extra row is never
 * rendered, it only answers "is there another page in this direction".
 */
export const listAuditPage = async (
  scope: AppScope,
  filters: AuditFilters,
  cursor: AuditCursor | null = null,
  db: DashboardDb = dashboardDb(),
  pageSize: number = AUDIT_PAGE_SIZE,
): Promise<AuditPage> => {
  const fetched = (await auditPageQuery(db, {
    scope,
    filters,
    cursor,
    limit: pageSize + 1,
  })) as AuditPageRow[];
  const backwards = cursor !== null && cursor.direction === 'newer';
  const extra = fetched.length > pageSize;
  const kept = fetched.slice(0, pageSize);
  const rows = backwards ? [...kept].reverse() : kept;
  const first = rows[0];
  const last = rows[rows.length - 1];
  // Paging forward, the extra row means older records exist; paging backward it means newer
  // ones do. The other direction is known from having come from a cursor at all.
  const hasOlder = backwards ? true : extra;
  const hasNewer = backwards ? extra : cursor !== null;
  return {
    rows,
    newer: hasNewer && first !== undefined ? { direction: 'newer', ...positionOf(first) } : null,
    older: hasOlder && last !== undefined ? { direction: 'older', ...positionOf(last) } : null,
  };
};

const positionOf = (row: AuditPageRow): { ts: Date; recordHash: string } => ({
  ts: row.ts,
  recordHash: row.recordHash,
});

/** The cursor string of a row, for a link. */
export const rowCursor = (row: AuditPageRow): string => encodeCursor(row);

/* ---------------------------------------------------------------- the reason filter --- */

/**
 * The suppress reasons actually present in the current app and date range, including every
 * `sensitive_category:<name>` variant, so the filter offers what can be found rather than a
 * hardcoded list that would drift from the taxonomy. Same lateral shape as the search: the
 * GROUP BY inside it is the optimisation fence.
 */
export const auditReasonsQuery = (db: DashboardDb, scope: AppScope, filters: AuditFilters) => {
  const window = auditWindow(filters);
  const slice = db
    .select({ reason: auditRecords.reason })
    .from(auditRecords)
    .where(
      and(
        eq(auditRecords.appId, apps.id),
        gte(auditRecords.ts, window.since),
        lt(auditRecords.ts, window.until),
        isNotNull(auditRecords.reason),
      ),
    )
    .groupBy(auditRecords.reason)
    .as('app_reasons');
  const base = db.selectDistinct({ reason: slice.reason }).from(apps).crossJoinLateral(slice);
  const appFilter = filters.appId === ALL_APPS ? undefined : eq(apps.id, filters.appId);
  const condition = and(appFilter, appScopeCondition(scope));
  const scoped = condition === undefined ? base : base.where(condition);
  return scoped.orderBy(asc(slice.reason));
};

export const listAuditReasons = async (
  scope: AppScope,
  filters: AuditFilters,
  db: DashboardDb = dashboardDb(),
): Promise<string[]> => {
  const rows = await auditReasonsQuery(db, scope, filters);
  return rows.flatMap((row) => (row.reason === null ? [] : [row.reason]));
};
