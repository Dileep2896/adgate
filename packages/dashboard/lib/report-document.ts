import { VERIFY_CHECK_NAMES } from './verify-labels';

/**
 * WHAT A VERIFICATION REPORT SAYS: the shape of the document an advertiser is handed, and the
 * definition of every number in it. lib/report.ts computes it; this file is what it means.
 *
 * Types and two constants only, with one dependency-free import, so a client component may pull
 * a type from here without dragging @adgateio/core into the browser bundle (the S31 lesson).
 *
 * The field names are snake_case, unlike the rest of this package: the document is stored as
 * jsonb, downloaded as JSON and read by people outside this repo, so it reads like the audit
 * record it aggregates rather than like a React prop.
 *
 * ------------------------------------------------------------------------------------------
 * DEFINITIONS (docs/audit.md, final paragraph: "A verification report for an advertiser is an
 * aggregate over records referencing that advertiser's creatives")
 *
 * THE SIGNED DOCUMENT IS THE ONLY SOURCE. decision, classification, disclosure and
 * separation_attestation are read from the signed JSON, never from the indexed column copies
 * beside it in Postgres - those are conveniences for lookups and are not covered by
 * record_hash. A record whose stored document no longer parses as an AuditRecord is counted in
 * `unreadable_records`, can satisfy no compliance rule, and fails chain integrity. Impressions
 * and clicks are the one exception and are said so in the document: events are reported by the
 * SDK after the turn and are not part of the signed record.
 *
 * records      Audit records referencing the advertiser's creatives in the period, counting each
 *              turn once (the generator selects is_latest rows, as lib/metrics.ts does).
 *
 *              WHICH RECORDS THAT IS, EXACTLY: the gateway stamps audit_records.advertiser_id
 *              only when a creative was actually served, so the report set is the SERVE records
 *              (and their attestations) that name one of this advertiser's creatives. A
 *              suppressed turn carries no advertiser, so it cannot enter anyone's report - a
 *              turn suppressed for a sensitive category is nobody's, which is why
 *              sensitive_exposures can honestly be 0 while the app suppressed such a turn.
 *              Every rule below is therefore stated over "every record in the report", and today
 *              that set contains serves only.
 * serves       Records whose signed decision is `serve`.
 * impressions  `impression` events on those turns. clicks: `click` events. ctr = clicks /
 *              impressions, null when there were no impressions.
 * categories   classification.categories of the turns the creatives appeared on. A turn with two
 *              categories counts in both, so the shares can add up to more than 100%. The
 *              denominator is the records whose document could be read.
 * sensitive    Records whose classification.sensitive is NOT empty: an ad that ran on a turn the
 *              classifier flagged. This MUST be zero for a healthy advertiser; the report states
 *              the actual number and flags it rather than hiding a non-zero count.
 * disclosure   Records whose disclosure label is non-empty, whose position is `after_answer` and
 *   compliance whose style is `separate_block` (docs/audit.md's disclosure_present check, all
 *              three conditions - lib/report.ts asserts the agreement), over EVERY record in the
 *              report. Since the report set is the serve records (see `records` above), that
 *              denominator is the serves; a suppression would count too if one could ever be
 *              attributed to an advertiser, and the fixture keeps that case for the day it can.
 * separation   Records with separation_attestation true, over the SERVE records only: a
 *   attestation suppressed turn rendered nothing and has nothing to attest.
 * chain        core verify() over every record: `all`, `partial`, `none` (or `empty` when the
 *   integrity  period holds no records), with the number of failures and which checks failed.
 *              It covers the six checks that decide whether a record is AUTHENTIC - schema,
 *              record_hash, chain, signature, creative_hash, supersedes (CHAIN_INTEGRITY_CHECKS)
 *              - and deliberately not the other two. docs/audit.md's report is three separate
 *              aggregates, and `disclosure_present` and `separation_attested` ARE the other two:
 *              counting them here as well would report the same gap twice and, worse, would call
 *              a perfectly intact chain "broken" because an integrator never attested. The
 *              document names the checks the number is over, so nothing is hidden.
 *
 * Every rate is 0..1 and is null when its denominator is 0 (lib/metrics.ts's rule: a rate over
 * nothing is unknown, not zero); the pages render them with formatPercent.
 * ------------------------------------------------------------------------------------------
 */

/** Bumped when the meaning of a field changes; stored inside every generated document. */
export const REPORT_VERSION = 1;

/** How many failing records the document names before it stops listing them. */
export const MAX_LISTED_FAILURES = 50;

/**
 * The verification checks chain integrity is measured over: everything docs/audit.md lists
 * except `disclosure_present` and `separation_attested`, which the report states as their own
 * percentages (see the header). In docs/audit.md order.
 */
export const CHAIN_INTEGRITY_CHECKS: readonly string[] = VERIFY_CHECK_NAMES.filter(
  (name) => name !== 'disclosure_present' && name !== 'separation_attested',
);

export interface ReportAdvertiser {
  id: string;
  name: string;
  domain: string;
}

/** The half-open period [start, end) the report covers, as ISO 8601 UTC. */
export interface ReportPeriod {
  start: string;
  end: string;
}

export interface ReportTotals {
  records: number;
  /** Records whose stored document no longer parses. Should be zero; see the header. */
  unreadable_records: number;
  serves: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
}

export interface ReportAppRow {
  app_id: string;
  app_name: string | null;
  records: number;
  serves: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
}

export interface ReportCategoryRow {
  category: string;
  records: number;
  /** records / the distribution's denominator, 0..1. */
  share: number | null;
}

export interface ReportCategoryDistribution {
  /** Records with a readable classification: the denominator of every share. */
  records: number;
  categories: ReportCategoryRow[];
}

export interface ReportSensitiveExposures {
  /** Records whose classification.sensitive is non-empty. MUST be zero. */
  records: number;
  /** records === 0. Stated explicitly so a reader never has to interpret the number. */
  healthy: boolean;
  categories: { category: string; records: number }[];
}

/** A "x of y, as a rate" claim: disclosure compliance and separation attestation. */
export interface ReportCompliance {
  passing: number;
  total: number;
  /** passing / total, 0..1; null when total is 0. */
  rate: number | null;
}

export type ChainIntegrityStatus = 'all' | 'partial' | 'none' | 'empty';

export interface ReportChainFailure {
  audit_id: string;
  record_hash: string;
  /** The checks that failed on this record, in docs/audit.md order. */
  checks: string[];
}

export interface ReportChainIntegrity {
  status: ChainIntegrityStatus;
  verified: number;
  failed: number;
  total: number;
  /** The checks this number is over: CHAIN_INTEGRITY_CHECKS, stated so nothing is implied. */
  checks: string[];
  /** Distinct failing check names across the report, in docs/audit.md order. */
  failed_checks: string[];
  /** The failing records, at most MAX_LISTED_FAILURES of them. */
  failures: ReportChainFailure[];
  /** Failures beyond the ones listed. */
  failures_omitted: number;
}

/**
 * WHAT THE SIGNATURE CHECK WAS ABLE TO DO. The `signature` check needs the deployment's public
 * keys (lib/verify-keys.ts), and a dashboard with none configured fails it on EVERY record -
 * which makes chain_integrity say BROKEN for a reason that has nothing to do with the records.
 * The report refuses to be quiet about that: it states where the keys came from and what was
 * wrong, and /reports/[id] puts it in a banner above the numbers.
 *
 * Optional because a document stored before this field existed is rendered as it was written.
 */
export interface ReportVerifier {
  /** `environment` when a key ring was configured and usable, `none` when it was empty. */
  key_source: 'environment' | 'none';
  /** What is wrong with the ring, naming variables and never key material; null when it is fine. */
  issue: string | null;
}

export interface ReportDocument {
  version: number;
  generated_at: string;
  verifier?: ReportVerifier;
  advertiser: ReportAdvertiser;
  period: ReportPeriod;
  totals: ReportTotals;
  by_app: ReportAppRow[];
  category_distribution: ReportCategoryDistribution;
  sensitive_exposures: ReportSensitiveExposures;
  disclosure_compliance: ReportCompliance;
  separation_attestation: ReportCompliance;
  chain_integrity: ReportChainIntegrity;
  /** True when the period held more records than `record_limit`; the numbers cover the rest. */
  truncated: boolean;
  record_limit: number;
}
