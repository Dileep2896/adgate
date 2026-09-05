import { apps, auditRecords, creatives, events, reports } from '@adgate/gateway/schema';
import {
  and,
  count,
  countDistinct,
  eq,
  exists,
  gte,
  lt,
  max,
  sql,
  type SQLWrapper,
} from 'drizzle-orm';

import { type DashboardDb, dashboardDb } from './db';
import {
  metricsWindow,
  type DecisionCountRow,
  type EventCountRow,
  type MetricsWindow,
} from './metrics';

/**
 * The SQL behind the overview numbers. Reads only (lib/db.ts); the arithmetic lives in the pure
 * lib/metrics.ts, which is why every query here GROUPs and COUNTs in Postgres and returns a
 * handful of buckets rather than a row per turn.
 *
 * INDEXES. audit_records is the biggest table in the database and the one holding the signed
 * chain, so nothing here may scan it whole: every access is filtered by (app_id, ts) and lands
 * on audit_records_app_id_ts_idx. The per-app queries do that directly. The global ones cannot
 * name an app, so instead of dropping the app_id filter they walk `apps` and take one indexed
 * slice per app with CROSS JOIN LATERAL, which is a nested loop of index scans. Events are
 * always reached from an audit record through events_audit_id_idx.
 * metrics-queries.integration.test.ts runs EXPLAIN on each of them and fails on a Seq Scan of
 * audit_records.
 */

/** The window the overview covers. */
export const METRICS_WINDOW_DAYS = 30;

/** The last METRICS_WINDOW_DAYS whole UTC days, ending now. */
export const defaultMetricsWindow = (now: Date = new Date()): MetricsWindow =>
  metricsWindow(now, METRICS_WINDOW_DAYS);

/** The UTC calendar day of an audit record's ts, as the key lib/metrics.ts groups on. */
const dayOf = (column: typeof auditRecords.ts) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;

/**
 * The window filter, always with the app_id equality in front of it so the composite index is
 * usable. is_latest keeps the attestation row of a turn from counting the turn twice.
 */
const inWindow = (appId: string | SQLWrapper, window: MetricsWindow) =>
  and(
    eq(auditRecords.appId, appId),
    gte(auditRecords.ts, window.since),
    lt(auditRecords.ts, window.until),
    eq(auditRecords.isLatest, true),
  );

/**
 * Sum of the ecpm of the creative each event's record served; 0 when the creative is gone.
 *
 * THE CURRENT ECPM, not the one that applied when the ad was served: the audit record names the
 * creative, and the rate lives on the catalog row, so editing a creative's ecpm rewrites the
 * estimated revenue of every past day it ran on. The overview says so in the metric's hint
 * (components/app-overview.tsx); capturing the rate at serve time would be a schema change.
 */
const ecpmTotal = sql<number>`coalesce(sum(${creatives.ecpm}), 0)::float8`;

/* -------------------------------------------------------------------------- one app --- */

/** Turns of one app, counted per (day, decision, reason). */
export const appDecisionCountsQuery = (db: DashboardDb, appId: string, window: MetricsWindow) => {
  const day = dayOf(auditRecords.ts);
  return db
    .select({
      day,
      decision: auditRecords.decision,
      reason: auditRecords.reason,
      count: count(),
    })
    .from(auditRecords)
    .where(inWindow(appId, window))
    .groupBy(day, auditRecords.decision, auditRecords.reason);
};

/**
 * Events of one app, counted per (day, type), with the ecpm of the creative on the turn they
 * belong to. The day is the TURN's day, so an event is always attributed to the turn it
 * measures even when it arrives later.
 */
export const appEventCountsQuery = (db: DashboardDb, appId: string, window: MetricsWindow) => {
  const day = dayOf(auditRecords.ts);
  return db
    .select({ day, type: events.type, count: count(), ecpmTotal })
    .from(auditRecords)
    .innerJoin(events, eq(events.auditId, auditRecords.id))
    .leftJoin(creatives, eq(creatives.id, auditRecords.creativeId))
    .where(inWindow(appId, window))
    .groupBy(day, events.type);
};

export const appDecisionCounts = async (
  appId: string,
  window: MetricsWindow,
  db: DashboardDb = dashboardDb(),
): Promise<DecisionCountRow[]> => appDecisionCountsQuery(db, appId, window);

export const appEventCounts = async (
  appId: string,
  window: MetricsWindow,
  db: DashboardDb = dashboardDb(),
): Promise<EventCountRow[]> => appEventCountsQuery(db, appId, window);

/* ------------------------------------------------------------------------- every app --- */

/**
 * THE LATERAL AGGREGATES, AND WHY. A global query cannot name an app, and
 * `... cross join lateral (select the rows of a.id)` does not help on its own: Postgres pulls a
 * plain subquery up into the outer join and goes straight back to reading audit_records whole.
 * A subquery that AGGREGATES cannot be pulled up, so each lateral below does its own GROUP BY.
 * The plan is then a nested loop that walks `apps` and takes one indexed slice per app, and the
 * outer query only adds the per-app groups together. The integration test EXPLAINs both.
 */

/** One app's turns, already grouped: the lateral of the global decision query. */
const appDaySlice = (db: DashboardDb, window: MetricsWindow) => {
  const day = dayOf(auditRecords.ts);
  return db
    .select({
      // A raw SQL field of a SUBQUERY must carry an alias, or the outer query cannot name it.
      day: day.as('day'),
      decision: auditRecords.decision,
      reason: auditRecords.reason,
      turns: count().as('turns'),
    })
    .from(auditRecords)
    .where(inWindow(apps.id, window))
    .groupBy(day, auditRecords.decision, auditRecords.reason)
    .as('app_days');
};

/** Turns of every app, counted per (day, decision, reason). */
export const globalDecisionCountsQuery = (db: DashboardDb, window: MetricsWindow) => {
  const slice = appDaySlice(db, window);
  return db
    .select({
      day: slice.day,
      decision: slice.decision,
      reason: slice.reason,
      count: sql<number>`sum(${slice.turns})::int`,
    })
    .from(apps)
    .crossJoinLateral(slice)
    .groupBy(slice.day, slice.decision, slice.reason);
};

/** One app's events, already grouped: the lateral of the global event query. */
const appEventDaySlice = (db: DashboardDb, window: MetricsWindow) => {
  const day = dayOf(auditRecords.ts);
  return db
    .select({
      day: day.as('day'),
      type: events.type,
      fired: count().as('fired'),
      ecpm: ecpmTotal.as('ecpm'),
    })
    .from(auditRecords)
    .innerJoin(events, eq(events.auditId, auditRecords.id))
    .leftJoin(creatives, eq(creatives.id, auditRecords.creativeId))
    .where(inWindow(apps.id, window))
    .groupBy(day, events.type)
    .as('app_event_days');
};

/** Events of every app, counted per (day, type), with the ecpm of the creative served. */
export const globalEventCountsQuery = (db: DashboardDb, window: MetricsWindow) => {
  const slice = appEventDaySlice(db, window);
  return db
    .select({
      day: slice.day,
      type: slice.type,
      count: sql<number>`sum(${slice.fired})::int`,
      ecpmTotal: sql<number>`sum(${slice.ecpm})::float8`,
    })
    .from(apps)
    .crossJoinLateral(slice)
    .groupBy(slice.day, slice.type);
};

/**
 * Apps that have written at least one audit record, ever - "apps integrated". EXISTS over the
 * app list rather than `count(distinct app_id)` over audit_records: the semi-join probes
 * audit_records_app_id_ts_idx once per app instead of reading the whole chain.
 */
export const appsIntegratedQuery = (db: DashboardDb) =>
  db
    .select({ total: count() })
    .from(apps)
    .where(
      exists(
        db
          .select({ one: sql`1` })
          .from(auditRecords)
          .where(eq(auditRecords.appId, apps.id)),
      ),
    );

/* --------------------------------------------------------------- the app list columns --- */

/**
 * The two per-app numbers the /apps table shows. They live here, with the other audit_records
 * readers, because they carry the same obligation: `select app_id, count(*) ... group by app_id`
 * answers the same question but can only be answered by reading the whole table, and it was
 * doing exactly that. Same shape as the laterals above - one aggregating subquery per app, which
 * Postgres cannot pull up - so the plan is a nested loop of index scans, and the EXPLAIN test
 * covers them by name.
 */

/** One app's turns in the window: the lateral of the app list's count column. */
const appWindowCountSlice = (db: DashboardDb, window: MetricsWindow) =>
  db
    .select({ turns: count().as('turns') })
    .from(auditRecords)
    .where(inWindow(apps.id, window))
    .as('app_window_turns');

/** Turns per app in the window, counting each turn once. One row per app, 0 included. */
export const appWindowCountsQuery = (db: DashboardDb, window: MetricsWindow) => {
  const slice = appWindowCountSlice(db, window);
  return db.select({ appId: apps.id, turns: slice.turns }).from(apps).crossJoinLateral(slice);
};

/** One app's most recent record, ever: max() is an aggregate, so it is a fence like the rest. */
const appLastTurnSlice = (db: DashboardDb) =>
  db
    .select({ lastTs: max(auditRecords.ts).as('last_ts') })
    .from(auditRecords)
    .where(and(eq(auditRecords.appId, apps.id), eq(auditRecords.isLatest, true)))
    .as('app_last_turn');

/** The timestamp of each app's most recent audit record, or null when it has none. */
export const appLastTurnsQuery = (db: DashboardDb) => {
  const slice = appLastTurnSlice(db);
  return db.select({ appId: apps.id, lastTs: slice.lastTs }).from(apps).crossJoinLateral(slice);
};

/** Advertisers with at least one generated verification report. S35 writes the rows. */
export const advertisersWithReportQuery = (db: DashboardDb) =>
  db.select({ total: countDistinct(reports.advertiserId) }).from(reports);

export interface GlobalMetricRows {
  decisions: DecisionCountRow[];
  events: EventCountRow[];
  appsIntegrated: number;
  advertisersWithReport: number;
}

/** Everything the /apps header needs, in four queries. */
export const globalMetricRows = async (
  window: MetricsWindow,
  db: DashboardDb = dashboardDb(),
): Promise<GlobalMetricRows> => {
  const [decisions, eventRows, integrated, withReport] = await Promise.all([
    globalDecisionCountsQuery(db, window),
    globalEventCountsQuery(db, window),
    appsIntegratedQuery(db),
    advertisersWithReportQuery(db),
  ]);
  return {
    decisions,
    events: eventRows,
    appsIntegrated: integrated[0]?.total ?? 0,
    advertisersWithReport: withReport[0]?.total ?? 0,
  };
};
