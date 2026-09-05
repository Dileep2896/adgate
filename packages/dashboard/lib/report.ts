import type { AuditRecord, VerifyResponse } from '@adgate/schemas';

import {
  CHAIN_INTEGRITY_CHECKS,
  type ChainIntegrityStatus,
  MAX_LISTED_FAILURES,
  type ReportAdvertiser,
  type ReportAppRow,
  type ReportCategoryDistribution,
  type ReportChainFailure,
  type ReportChainIntegrity,
  type ReportCompliance,
  type ReportDocument,
  type ReportPeriod,
  type ReportSensitiveExposures,
  type ReportTotals,
  type ReportVerifier,
  REPORT_VERSION,
} from './report-document';
import { VERIFY_CHECK_NAMES } from './verify-labels';

/**
 * HOW A VERIFICATION REPORT IS COMPUTED. lib/report-document.ts is what each number MEANS -
 * read that first; this file turns the records into it, and re-exports the document types so
 * the rest of the package has one import to remember.
 *
 * PURE. No database, no React, no environment, no clock (`generatedAt` is an argument). Every
 * number is computed from plain inputs - the audit records that reference the advertiser's
 * creatives, the impression and click counts of each of those turns, and the result core's
 * verify() gave for each record - so lib/report.test.ts hand-computes every figure from a
 * fixture instead of from a database. The only imports are types (erased) and two
 * dependency-free modules; nothing here can drag @adgate/core into a browser bundle.
 */

export * from './report-document';

/** One audit record as the report sees it. */
export interface ReportRecordInput {
  auditId: string;
  recordHash: string;
  appId: string;
  appName: string | null;
  /** audit_records.ts as ISO 8601 UTC. */
  ts: string;
  /** The stored signed document, parsed; null when it no longer satisfies AuditRecord. */
  record: AuditRecord | null;
  /** `impression` events on this turn (0 or 1 in practice: duplicates are ignored, S19). */
  impressions: number;
  clicks: number;
  /** What core verify() said about this record, with the gateway's own VerifyContext. */
  verification: VerifyResponse;
}

export interface ReportInput {
  advertiser: ReportAdvertiser;
  period: ReportPeriod;
  /** ISO 8601 UTC; passed in, never read from a clock. */
  generatedAt: string;
  records: readonly ReportRecordInput[];
  /** True when more records matched the period than the generator was willing to load. */
  truncated: boolean;
  /** The cap that produced `truncated`, stated so a reader knows what was applied. */
  recordLimit: number;
  /**
   * Where the keys the `signature` check used came from, when the caller knows. Omitted by the
   * unit tests, which hand in verify() results directly and have no ring to describe.
   */
  verifier?: ReportVerifier;
}

/** x / y, or null when y is 0: a rate with no denominator is unknown, not zero. */
const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const compliance = (passing: number, total: number): ReportCompliance => ({
  passing,
  total,
  rate: ratio(passing, total),
});

/** Counts by key, returned most frequent first and alphabetically within a tie. */
const rank = (counts: Map<string, number>): { key: string; count: number }[] =>
  [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

const bump = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const isServe = (input: ReportRecordInput): boolean => input.record?.decision === 'serve';

/**
 * docs/audit.md's disclosure_present check, applied to the report: a non-empty label, in the
 * after_answer position, as a separate_block. An unreadable document cannot pass.
 *
 * ALL THREE CONDITIONS, because this must agree with core's checkDisclosure on every record -
 * a report that called a turn compliant while GET /v1/verify/:id failed it would be worse than
 * no report. lib/report.test.ts asserts the agreement over the fixture rather than trusting the
 * two lists to stay in step.
 */
export const isDisclosureCompliant = (record: AuditRecord | null): boolean =>
  record !== null &&
  record.disclosure.label.trim() !== '' &&
  record.disclosure.position === 'after_answer' &&
  record.disclosure.style === 'separate_block';

/** The integrity checks this record failed, in docs/audit.md order. */
const failedChecksOf = (input: ReportRecordInput): string[] =>
  input.verification.checks
    .filter((check) => !check.ok && CHAIN_INTEGRITY_CHECKS.includes(check.name))
    .map((check) => check.name);

const statusOf = (verified: number, total: number): ChainIntegrityStatus => {
  if (total === 0) {
    return 'empty';
  }
  if (verified === total) {
    return 'all';
  }
  return verified === 0 ? 'none' : 'partial';
};

const byApp = (records: readonly ReportRecordInput[]): ReportAppRow[] => {
  const rows = new Map<string, ReportAppRow>();
  for (const input of records) {
    const row = rows.get(input.appId) ?? {
      app_id: input.appId,
      app_name: input.appName,
      records: 0,
      serves: 0,
      impressions: 0,
      clicks: 0,
      ctr: null,
    };
    row.records += 1;
    row.serves += isServe(input) ? 1 : 0;
    row.impressions += input.impressions;
    row.clicks += input.clicks;
    rows.set(input.appId, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, ctr: ratio(row.clicks, row.impressions) }))
    .sort(
      (a, b) =>
        b.impressions - a.impressions || b.records - a.records || a.app_id.localeCompare(b.app_id),
    );
};

const categoryDistribution = (
  records: readonly ReportRecordInput[],
): ReportCategoryDistribution => {
  const counts = new Map<string, number>();
  let readable = 0;
  for (const input of records) {
    if (input.record === null) {
      continue;
    }
    readable += 1;
    for (const category of new Set(input.record.classification.categories)) {
      bump(counts, category);
    }
  }
  return {
    records: readable,
    categories: rank(counts).map(({ key, count }) => ({
      category: key,
      records: count,
      share: ratio(count, readable),
    })),
  };
};

const sensitiveExposures = (records: readonly ReportRecordInput[]): ReportSensitiveExposures => {
  const counts = new Map<string, number>();
  let exposed = 0;
  for (const input of records) {
    const sensitive = input.record?.classification.sensitive ?? [];
    if (sensitive.length === 0) {
      continue;
    }
    exposed += 1;
    for (const category of new Set(sensitive)) {
      bump(counts, category);
    }
  }
  return {
    records: exposed,
    healthy: exposed === 0,
    categories: rank(counts).map(({ key, count }) => ({ category: key, records: count })),
  };
};

const chainIntegrity = (records: readonly ReportRecordInput[]): ReportChainIntegrity => {
  const failures: ReportChainFailure[] = [];
  const failedChecks = new Set<string>();
  let verified = 0;
  for (const input of records) {
    const checks = failedChecksOf(input);
    if (checks.length === 0) {
      verified += 1;
      continue;
    }
    for (const check of checks) {
      failedChecks.add(check);
    }
    failures.push({ audit_id: input.auditId, record_hash: input.recordHash, checks });
  }
  return {
    status: statusOf(verified, records.length),
    verified,
    failed: failures.length,
    total: records.length,
    checks: [...CHAIN_INTEGRITY_CHECKS],
    failed_checks: VERIFY_CHECK_NAMES.filter((name) => failedChecks.has(name)),
    failures: failures.slice(0, MAX_LISTED_FAILURES),
    failures_omitted: Math.max(0, failures.length - MAX_LISTED_FAILURES),
  };
};

const totalsOf = (records: readonly ReportRecordInput[]): ReportTotals => {
  const impressions = records.reduce((sum, input) => sum + input.impressions, 0);
  const clicks = records.reduce((sum, input) => sum + input.clicks, 0);
  return {
    records: records.length,
    unreadable_records: records.filter((input) => input.record === null).length,
    serves: records.filter(isServe).length,
    impressions,
    clicks,
    ctr: ratio(clicks, impressions),
  };
};

/** The whole document, from the records and their verification results. */
export const computeReport = (input: ReportInput): ReportDocument => {
  const { records } = input;
  const serves = records.filter(isServe);
  return {
    version: REPORT_VERSION,
    generated_at: input.generatedAt,
    // Written only when the caller knows: an absent `verifier` is "not stated", never "fine".
    ...(input.verifier === undefined ? {} : { verifier: input.verifier }),
    advertiser: input.advertiser,
    period: input.period,
    totals: totalsOf(records),
    by_app: byApp(records),
    category_distribution: categoryDistribution(records),
    sensitive_exposures: sensitiveExposures(records),
    disclosure_compliance: compliance(
      records.filter((entry) => isDisclosureCompliant(entry.record)).length,
      records.length,
    ),
    separation_attestation: compliance(
      serves.filter((entry) => entry.record?.separation_attestation === true).length,
      serves.length,
    ),
    chain_integrity: chainIntegrity(records),
    truncated: input.truncated,
    record_limit: input.recordLimit,
  };
};
