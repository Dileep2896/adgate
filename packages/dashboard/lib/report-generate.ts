import { verify } from '@adgate/core';
import {
  type AuditReader,
  type AuditRecordRow,
  buildVerifyContext,
  createAuditReader,
} from '@adgate/gateway/audit';
import { AuditRecord } from '@adgate/schemas';

import { type DashboardDb, dashboardDb } from './db';
import {
  computeReport,
  type ReportAdvertiser,
  type ReportDocument,
  type ReportPeriod,
  type ReportRecordInput,
} from './report';
import { type BundleRecord, buildReportBundle, type ReportBundle } from './report-bundle';
import {
  countReportRecords,
  listReportCreatives,
  MAX_REPORT_RECORDS,
  reportEventCounts,
  type ReportRange,
  reportRecordsQuery,
  type StoredReport,
} from './report-queries';
import type { ReportWriter } from './report-store';
import { type VerifyKeys, verifyKeys } from './verify-keys';

/**
 * Generating a verification report: read the advertiser's records, verify every one of them the
 * way GET /v1/verify/:id does, compute the document with the pure lib/report.ts, store it.
 *
 * THE VERIFICATION IS THE GATEWAY'S (the S34 decision, and it matters more here). verify()'s
 * verdict is entirely a function of the VerifyContext it is handed, so this module uses the
 * gateway's OWN createAuditReader and buildVerifyContext through `@adgate/gateway/audit` rather
 * than assembling a context of its own. A report that graded records more leniently than the
 * audit API would be worse than no report at all.
 *
 * Reads go through the read-only handle. The single INSERT goes through a ReportWriter
 * (lib/report-store.ts), which the server action builds from lib/db-write.ts.
 */

/** Verifications in flight at once. The read pool holds four connections (lib/db.ts). */
const VERIFY_CONCURRENCY = 4;

export interface ReportContext {
  db?: DashboardDb;
  /** Injected by the tests so they verify against the ring their fixture signed with. */
  keys?: VerifyKeys;
}

export interface ReportData {
  records: ReportRecordInput[];
  bundleRecords: BundleRecord[];
  supportingRecords: BundleRecord[];
  creativeIds: string[];
  truncated: boolean;
  matched: number;
}

const bundleRecordOf = (row: AuditRecordRow): BundleRecord => ({
  audit_id: row.id,
  app_id: row.appId,
  seq: row.seq,
  record_hash: row.recordHash,
  is_latest: row.isLatest,
  ts: row.ts.toISOString(),
  record: row.record,
});

/**
 * The reader, with every lookup remembered for the life of one generation. buildVerifyContext
 * asks for the predecessor of every record and the bundle asks for the same rows again, and in a
 * chain of consecutive records most of those are each other - so without this a 2 000 record
 * report would run several thousand redundant single-row queries.
 */
const cachedReader = (reader: AuditReader): AuditReader => {
  const bySeq = new Map<string, Promise<AuditRecordRow | null>>();
  const byHash = new Map<string, Promise<AuditRecordRow | null>>();
  const latest = new Map<string, Promise<AuditRecordRow | null>>();
  const creativeHashes = new Map<string, Promise<string | null>>();
  const memo = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
    const existing = cache.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const loaded = load();
    cache.set(key, loaded);
    return loaded;
  };
  return {
    findVersion: (query) => reader.findVersion(query),
    findLatest: (auditId) => memo(latest, auditId, () => reader.findLatest(auditId)),
    findByHash: (recordHash) => memo(byHash, recordHash, () => reader.findByHash(recordHash)),
    findBySeq: (appId, seq) =>
      memo(bySeq, `${appId}#${String(seq)}`, () => reader.findBySeq(appId, seq)),
    creativeHash: (creativeId) =>
      memo(creativeHashes, creativeId, () => reader.creativeHash(creativeId)),
  };
};

/** Runs `work` over the items, at most `limit` at a time, keeping the input order. */
const mapLimited = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** The records around one record that its checks read: seq - 1, and any superseded version. */
const supportingOf = async (
  reader: AuditReader,
  row: AuditRecordRow,
): Promise<AuditRecordRow[]> => {
  const found: AuditRecordRow[] = [];
  const previous = row.seq > 1 ? await reader.findBySeq(row.appId, row.seq - 1) : null;
  if (previous !== null) {
    found.push(previous);
  }
  if (row.supersedesHash !== null) {
    const superseded = await reader.findByHash(row.supersedesHash);
    if (superseded !== null) {
      found.push(superseded);
      const before =
        superseded.seq > 1 ? await reader.findBySeq(superseded.appId, superseded.seq - 1) : null;
      if (before !== null) {
        found.push(before);
      }
    }
  }
  return found;
};

const creativeIdOfRecord = (record: unknown): string | null =>
  AuditRecord.safeParse(record).data?.creative?.id ?? null;

/**
 * Everything a report and its bundle are built from, for one advertiser and period. Verifies
 * every record; never throws on a bad record (verify() reports, it does not raise).
 */
export const collectReportData = async (
  range: ReportRange,
  context: ReportContext = {},
): Promise<ReportData> => {
  const db = context.db ?? dashboardDb();
  const keys = context.keys ?? verifyKeys();
  const reader = cachedReader(createAuditReader(db));

  const [rows, matched, events] = await Promise.all([
    reportRecordsQuery(db, range, MAX_REPORT_RECORDS),
    countReportRecords(range, db),
    reportEventCounts(range, db),
  ]);

  const verified = await mapLimited(rows, VERIFY_CONCURRENCY, async ({ row, appName }) => {
    const [ctx, supporting] = await Promise.all([
      buildVerifyContext(reader, row),
      supportingOf(reader, row),
    ]);
    const counts = events.get(row.id) ?? { impressions: 0, clicks: 0 };
    const input: ReportRecordInput = {
      auditId: row.id,
      recordHash: row.recordHash,
      appId: row.appId,
      appName,
      ts: row.ts.toISOString(),
      record: AuditRecord.safeParse(row.record).data ?? null,
      impressions: counts.impressions,
      clicks: counts.clicks,
      verification: verify(row.record, keys.ring, ctx),
    };
    return { input, row, supporting };
  });

  return {
    records: verified.map((entry) => entry.input),
    bundleRecords: verified.map((entry) => bundleRecordOf(entry.row)),
    supportingRecords: verified.flatMap((entry) => entry.supporting.map(bundleRecordOf)),
    creativeIds: verified.flatMap((entry) => {
      const id = creativeIdOfRecord(entry.row.record);
      return id === null ? [] : [id];
    }),
    truncated: matched > rows.length,
    matched,
  };
};

export interface GenerateReportInput {
  advertiser: ReportAdvertiser;
  /** Inclusive. */
  since: Date;
  /** Exclusive. */
  until: Date;
  /** Passed in so the document's generated_at is the caller's clock, never this module's. */
  now?: Date;
}

export interface GenerateReportResult {
  id: string;
  document: ReportDocument;
}

const periodOf = (since: Date, until: Date): ReportPeriod => ({
  start: since.toISOString(),
  end: until.toISOString(),
});

/**
 * Generates a report and stores it. Returns the rep_ id the page redirects to.
 *
 * This is the call that makes the "advertisers with at least one generated report" number on
 * /apps move: it is the only writer of the `reports` table.
 */
export const generateReport = async (
  input: GenerateReportInput,
  writer: ReportWriter,
  context: ReportContext = {},
): Promise<GenerateReportResult> => {
  const range: ReportRange = {
    advertiserId: input.advertiser.id,
    since: input.since,
    until: input.until,
  };
  const data = await collectReportData(range, context);
  const document = computeReport({
    advertiser: input.advertiser,
    period: periodOf(input.since, input.until),
    generatedAt: (input.now ?? new Date()).toISOString(),
    records: data.records,
    truncated: data.truncated,
    recordLimit: MAX_REPORT_RECORDS,
  });
  const id = await writer.save({
    advertiserId: input.advertiser.id,
    periodStart: input.since,
    periodEnd: input.until,
    document,
  });
  return { id, document };
};

/**
 * The downloadable bundle for a stored report.
 *
 * The records are re-read and re-collected NOW rather than frozen at generation time: the report
 * document is the claim, the records are the evidence, and evidence pulled from the live
 * database is what makes the download worth checking. If a record has been edited since the
 * report was generated, the bundle carries the edited record and fails to verify offline -
 * which is exactly the fact an auditor wants to learn.
 */
export const loadReportBundle = async (
  report: StoredReport,
  context: ReportContext = {},
): Promise<ReportBundle> => {
  const db = context.db ?? dashboardDb();
  const keys = context.keys ?? verifyKeys();
  const advertiser: ReportAdvertiser = {
    id: report.advertiserId,
    name: report.advertiserName,
    domain: report.advertiserDomain,
  };
  const data = await collectReportData(
    { advertiserId: report.advertiserId, since: report.periodStart, until: report.periodEnd },
    { ...context, db, keys },
  );
  const creatives = await listReportCreatives(data.creativeIds, db);
  return buildReportBundle({
    reportId: report.id,
    generatedAt: report.createdAt.toISOString(),
    advertiser,
    period: periodOf(report.periodStart, report.periodEnd),
    report: report.document,
    records: data.bundleRecords,
    supportingRecords: data.supportingRecords,
    creatives,
    publicKeys: keys.pems,
  });
};
