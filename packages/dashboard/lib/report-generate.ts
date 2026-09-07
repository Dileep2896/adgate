import { verify } from '@adgateio/core';
import {
  type AuditReader,
  type AuditRecordRow,
  buildVerifyContext,
  createAuditReader,
} from '@adgateio/gateway/audit';
import { AuditRecord } from '@adgateio/schemas';

import { type DashboardDb, dashboardDb } from './db';
import {
  computeReport,
  type ReportAdvertiser,
  type ReportDocument,
  type ReportPeriod,
  type ReportRecordInput,
  type ReportVerifier,
} from './report';
import {
  type BundleRecord,
  buildReportBundle,
  type ReportBundle,
  type SupportingRecord,
  type SupportingRole,
} from './report-bundle';
import {
  countReportRecords,
  listReportCreatives,
  MAX_REPORT_RECORDS,
  reportEventCounts,
  type ReportRange,
  reportRecordsQuery,
  type StoredReport,
} from './report-queries';
import { cachedReader, mapLimited } from './report-reader';
import type { ReportWriter } from './report-store';
import { type VerifyKeys, verifyKeys } from './verify-keys';

/**
 * Generating a verification report: read the advertiser's records, verify every one of them the
 * way GET /v1/verify/:id does, compute the document with the pure lib/report.ts, store it.
 *
 * THE VERIFICATION IS THE GATEWAY'S (the S34 decision, and it matters more here). verify()'s
 * verdict is entirely a function of the VerifyContext it is handed, so this module uses the
 * gateway's OWN createAuditReader and buildVerifyContext through `@adgateio/gateway/audit` rather
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
  /** The clock, for the bundle's collected_at. Passed in so a test can pin it. */
  now?: Date;
}

export interface ReportData {
  records: ReportRecordInput[];
  bundleRecords: BundleRecord[];
  /** Each carries WHY it is here; the bundle reduces the predecessor-only ones. */
  supportingRecords: SupportingRecord[];
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
 * The records around one record that its checks read, each with the ROLE that says how much of
 * it the bundle may carry: the positional predecessor at seq - 1 (usually another advertiser's
 * turn - a chain reference only), any superseded version of this same record (this advertiser's
 * own turn - the whole document), and that version's own predecessor (a reference again).
 */
const supportingOf = async (
  reader: AuditReader,
  row: AuditRecordRow,
): Promise<{ row: AuditRecordRow; role: SupportingRole }[]> => {
  const found: { row: AuditRecordRow; role: SupportingRole }[] = [];
  const previous = row.seq > 1 ? await reader.findBySeq(row.appId, row.seq - 1) : null;
  if (previous !== null) {
    found.push({ row: previous, role: 'predecessor' });
  }
  if (row.supersedesHash !== null) {
    const superseded = await reader.findByHash(row.supersedesHash);
    if (superseded !== null) {
      found.push({ row: superseded, role: 'superseded' });
      const before =
        superseded.seq > 1 ? await reader.findBySeq(superseded.appId, superseded.seq - 1) : null;
      if (before !== null) {
        found.push({ row: before, role: 'predecessor' });
      }
    }
  }
  return found;
};

const creativeIdOfRecord = (record: unknown): string | null =>
  AuditRecord.safeParse(record).data?.creative?.id ?? null;

/**
 * What the stored document says about the keys the `signature` check ran against.
 *
 * verifyKeys() never throws and reports an unusable or missing ring as `issue` instead
 * (lib/verify-keys.ts). Generation goes ahead either way - refusing would leave an operator with
 * no report and no explanation - but the reason is carried INTO the document, because with an
 * empty ring every record fails `signature` and chain_integrity reads BROKEN for a reason that
 * is about this deployment's configuration and not about the records.
 */
export const reportVerifier = (keys: VerifyKeys): ReportVerifier => ({
  key_source: keys.ring.key_ids.length === 0 ? 'none' : 'environment',
  issue: keys.issue,
});

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
    supportingRecords: verified.flatMap((entry) =>
      entry.supporting.map(({ row, role }) => ({ ...bundleRecordOf(row), role })),
    ),
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
  /**
   * The apps whose records may be reported on, or null for every app. Resolved from the
   * generating session's scope, so a member's report is about their own traffic even though the
   * advertiser it names may also have served somebody else's app.
   */
  appIds: string[] | null;
  /** The account the stored report belongs to, or null when the operator generated it. */
  ownerUserId: string | null;
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
    appIds: input.appIds,
  };
  // Resolved here so the document can SAY which keys graded it, rather than leaving a reader to
  // guess why every record failed `signature` (see reportVerifier).
  const keys = context.keys ?? verifyKeys();
  const data = await collectReportData(range, { ...context, keys });
  const document = computeReport({
    advertiser: input.advertiser,
    period: periodOf(input.since, input.until),
    generatedAt: (input.now ?? new Date()).toISOString(),
    records: data.records,
    truncated: data.truncated,
    recordLimit: MAX_REPORT_RECORDS,
    verifier: reportVerifier(keys),
  });
  const id = await writer.save({
    advertiserId: input.advertiser.id,
    periodStart: input.since,
    periodEnd: input.until,
    ownerUserId: input.ownerUserId,
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
 *
 * That is why the bundle carries TWO timestamps: `generated_at` is the report's, `collected_at`
 * is this read. They are days apart on a report downloaded twice, and a reader comparing the
 * document with the evidence has to know which date belongs to which.
 */
export const loadReportBundle = async (
  report: StoredReport,
  /** The apps the DOWNLOADER may see; null for an admin. Re-scoped, not trusted to the report. */
  appIds: string[] | null,
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
    {
      advertiserId: report.advertiserId,
      since: report.periodStart,
      until: report.periodEnd,
      appIds,
    },
    { ...context, db, keys },
  );
  const creatives = await listReportCreatives(data.creativeIds, db);
  return buildReportBundle({
    reportId: report.id,
    generatedAt: report.createdAt.toISOString(),
    collectedAt: (context.now ?? new Date()).toISOString(),
    advertiser,
    period: periodOf(report.periodStart, report.periodEnd),
    report: report.document,
    records: data.bundleRecords,
    supportingRecords: data.supportingRecords,
    creatives,
    publicKeys: keys.pems,
  });
};
