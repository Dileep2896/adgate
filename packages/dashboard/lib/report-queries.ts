import {
  advertisers,
  apps,
  auditRecords,
  creatives,
  events,
  reports,
} from '@adgateio/gateway/schema';
import { and, asc, count, desc, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm';

import type { AppScope } from './app-scope';
import { type DashboardDb, dashboardDb } from './db';
import type { ReportDocument } from './report';
import type { BundleCreative } from './report-bundle';
import { reportScopeCondition } from './scope-queries';

/**
 * The SQL behind /reports. Reads only (lib/db.ts); the writes are one INSERT in
 * lib/report-store.ts, reached through the server action's read-write handle.
 *
 * NO QUERY MAY SCAN audit_records (the S32 rule). A report is "every record referencing this
 * advertiser's creatives between two dates", which is exactly the column pair
 * audit_records_advertiser_id_ts_idx covers, so the slice below is an index range and the events
 * of those turns are reached from it through events_audit_id_idx.
 *
 * advertiser_id IS WRITTEN ON SERVES ONLY (packages/gateway/src/evaluate/audit-store.ts: it is
 * the served creative's advertiser, and a suppressed turn has no creative), so the set below is
 * the advertiser's serve records and their attestations. A suppression is nobody's record and
 * can appear in no report; attributing one would mean the gateway recording the advertiser it
 * WOULD have served, which it does not do.
 * lib/metrics-queries.integration.test.ts EXPLAINs both against 10 000 records and fails on a
 * Seq Scan.
 *
 * is_latest, as in lib/metrics.ts: attestation writes a SECOND row for the same turn, and a
 * report that counted an attested impression twice would overstate what the advertiser was
 * delivered. The superseded version is still in the bundle - buildVerifyContext reaches it
 * through supersedes_hash - it is just not counted again.
 */

/**
 * The most records one report will load. A report is generated on demand and every record in it
 * is verified with Ed25519, so this is the point at which an operator gets a truncated report
 * with a warning instead of a page that never finishes. The document says `truncated` and
 * `record_limit` so nobody has to guess whether they are looking at everything.
 */
export const MAX_REPORT_RECORDS = 2000;

/** How many generated reports /reports lists. */
export const REPORT_LIST_LIMIT = 100;

export interface ReportRange {
  advertiserId: string;
  /** Inclusive. */
  since: Date;
  /** Exclusive. */
  until: Date;
  /**
   * The apps whose records may go into this report, or null for "every app" (an admin).
   *
   * AN ADVERTISER'S RECORDS SPAN APPS, so this is the one place a predicate on `apps` is not
   * available: the range starts from `audit_records.advertiser_id`. The ids are resolved in
   * JavaScript by visibleAppIds() (lib/scope-queries.ts) and inlined, which keeps
   * audit_records_advertiser_id_ts_idx as the index condition of the range scan rather than
   * turning it into a semi-join. Null leaves the query the EXPLAIN suite plans untouched.
   */
  appIds: string[] | null;
}

/** `app_id in (…)`, or the constant false when the scope owns no apps at all. */
const appsInRange = (appIds: string[] | null): SQL | undefined => {
  if (appIds === null) {
    return undefined;
  }
  return appIds.length === 0 ? sql`false` : inArray(auditRecords.appId, appIds);
};

const inRange = (range: ReportRange) =>
  and(
    eq(auditRecords.advertiserId, range.advertiserId),
    gte(auditRecords.ts, range.since),
    lt(auditRecords.ts, range.until),
    eq(auditRecords.isLatest, true),
    appsInRange(range.appIds),
  );

/**
 * The records the report is about, oldest first. Selects the WHOLE audit_records row: the
 * gateway's buildVerifyContext takes an AuditRecordRow, and the bundle carries the record as it
 * is stored. Exported so the EXPLAIN test can plan it.
 */
export const reportRecordsQuery = (
  db: DashboardDb,
  range: ReportRange,
  limit: number = MAX_REPORT_RECORDS,
) =>
  db
    .select({ row: auditRecords, appName: apps.name })
    .from(auditRecords)
    .leftJoin(apps, eq(apps.id, auditRecords.appId))
    .where(inRange(range))
    .orderBy(asc(auditRecords.ts), asc(auditRecords.recordHash))
    .limit(limit);

export type ReportRecordRow = Awaited<ReturnType<typeof reportRecordsQuery>>[number];

/** Impressions and clicks of those turns, counted in Postgres. Exported for the EXPLAIN test. */
export const reportEventCountsQuery = (db: DashboardDb, range: ReportRange) =>
  db
    .select({ auditId: auditRecords.id, type: events.type, count: count() })
    .from(auditRecords)
    .innerJoin(events, eq(events.auditId, auditRecords.id))
    .where(inRange(range))
    .groupBy(auditRecords.id, events.type);

export interface ReportEventCounts {
  impressions: number;
  clicks: number;
}

/** audit id -> its impression and click counts. */
export const reportEventCounts = async (
  range: ReportRange,
  db: DashboardDb = dashboardDb(),
): Promise<Map<string, ReportEventCounts>> => {
  const rows = await reportEventCountsQuery(db, range);
  const counts = new Map<string, ReportEventCounts>();
  for (const row of rows) {
    const entry = counts.get(row.auditId) ?? { impressions: 0, clicks: 0 };
    if (row.type === 'impression') {
      entry.impressions += row.count;
    } else if (row.type === 'click') {
      entry.clicks += row.count;
    }
    counts.set(row.auditId, entry);
  }
  return counts;
};

/** How many records match, so a truncated report can say so honestly. */
export const countReportRecords = async (
  range: ReportRange,
  db: DashboardDb = dashboardDb(),
): Promise<number> => {
  const [row] = await db.select({ total: count() }).from(auditRecords).where(inRange(range));
  return row?.total ?? 0;
};

/**
 * The six content fields of the creatives the records name, for the bundle. The advertiser name
 * and domain come from the advertisers row, which is what creativeContentHash hashes.
 */
export const listReportCreatives = async (
  ids: readonly string[],
  db: DashboardDb = dashboardDb(),
): Promise<BundleCreative[]> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return [];
  }
  return db
    .select({
      id: creatives.id,
      advertiser: advertisers.name,
      advertiser_domain: advertisers.domain,
      headline: creatives.headline,
      body: creatives.body,
      cta: creatives.cta,
      url_template: creatives.urlTemplate,
    })
    .from(creatives)
    .innerJoin(advertisers, eq(creatives.advertiserId, advertisers.id))
    .where(inArray(creatives.id, unique));
};

/* --------------------------------------------------------------- the generated reports --- */

export interface StoredReport {
  id: string;
  advertiserId: string;
  advertiserName: string;
  advertiserDomain: string;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
  /** The account that generated it, or null for one the operator generated. */
  ownerUserId: string | null;
  document: ReportDocument;
}

const storedReportColumns = {
  id: reports.id,
  advertiserId: reports.advertiserId,
  advertiserName: advertisers.name,
  advertiserDomain: advertisers.domain,
  periodStart: reports.periodStart,
  periodEnd: reports.periodEnd,
  createdAt: reports.createdAt,
  ownerUserId: reports.ownerUserId,
  document: reports.report,
};

type StoredReportRow = Omit<StoredReport, 'document'> & { document: Record<string, unknown> };

/**
 * The `report` column is opaque jsonb (the table is from S32; S35 owns what goes in it), so it
 * comes back as Record<string, unknown> and is asserted to be the document this build writes.
 * Nothing re-validates it: a report is a stored artifact, and a document from an older version
 * of this module is displayed as it was written rather than refused.
 */
const asStoredReport = (row: StoredReportRow): StoredReport => ({
  ...row,
  document: row.document as unknown as ReportDocument,
});

/** The reports this scope generated, newest first. An admin sees every one. */
export const listReports = async (
  scope: AppScope,
  db: DashboardDb = dashboardDb(),
  limit: number = REPORT_LIST_LIMIT,
): Promise<StoredReport[]> => {
  const base = db
    .select(storedReportColumns)
    .from(reports)
    .innerJoin(advertisers, eq(reports.advertiserId, advertisers.id));
  const owned = reportScopeCondition(scope);
  const scoped = owned === undefined ? base : base.where(owned);
  const rows = await scoped.orderBy(desc(reports.createdAt), desc(reports.id)).limit(limit);
  return rows.map(asStoredReport);
};

/** One stored report, or null - including when it belongs to another account. */
export const getReport = async (
  scope: AppScope,
  id: string,
  db: DashboardDb = dashboardDb(),
): Promise<StoredReport | null> => {
  const [row] = await db
    .select(storedReportColumns)
    .from(reports)
    .innerJoin(advertisers, eq(reports.advertiserId, advertisers.id))
    .where(and(eq(reports.id, id), reportScopeCondition(scope)))
    .limit(1);
  return row === undefined ? null : asStoredReport(row);
};

export interface ReportAdvertiserOption {
  id: string;
  name: string;
  domain: string;
}

/** Every advertiser, for the /reports/new select. */
export const listReportAdvertisers = (
  db: DashboardDb = dashboardDb(),
): Promise<ReportAdvertiserOption[]> =>
  db
    .select({ id: advertisers.id, name: advertisers.name, domain: advertisers.domain })
    .from(advertisers)
    .orderBy(asc(advertisers.name));
