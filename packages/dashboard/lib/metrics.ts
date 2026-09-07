import type { Decision, EventType } from '@adgateio/schemas';

/**
 * The dashboard's metric arithmetic, and the only place that defines what each number means.
 *
 * PURE: no database, no React, no environment, no clock. Every function takes plain rows -
 * already grouped and counted by Postgres (lib/metrics-queries.ts) - and returns numbers, so
 * the definitions below are unit tested against a hand written fixture rather than against a
 * database. The type-only imports from @adgateio/schemas are erased at compile time, so this
 * module ships nothing to the browser and a client component may import its types freely.
 *
 * ------------------------------------------------------------------------------------------
 * DEFINITIONS (the contract the pages and the tests share)
 *
 * turns_evaluated  Audit records in the window, counting each turn ONCE. Attestation writes a
 *                  second row for the same audit id (docs/audit.md), so the query keeps only
 *                  the is_latest row; nothing here has to de-duplicate.
 *
 * ad_eligible      Turns where policy allowed an ad, i.e. every rule up to and including
 *                  frequency_caps passed and the gateway went on to ask demand for a creative.
 *                  That is exactly `decision = serve` (a creative came back) plus
 *                  `reason = no_fill` (demand was asked and had nothing). Every other suppress
 *                  reason - paid_user, region_blocked, sensitive_category:<name>,
 *                  low_confidence, low_commercial_intent, frequency_cap - is a policy rejection
 *                  that happens BEFORE demand is called. `error` is deliberately NOT eligible:
 *                  a failure can happen at any stage and adgate fails closed, so a turn whose
 *                  eligibility cannot be proved is not counted as eligible.
 *
 * eligible_rate    ad_eligible / turns_evaluated.
 * fill_rate        serves / ad_eligible.
 * ctr              clicks / impressions.
 * revenue          sum over impressions of (the served creative's ecpm / 1000). Postgres sums
 *                  the ecpm side (ecpmTotal); the division lives here.
 * rpm              revenue / ad_eligible * 1000 - revenue per thousand ELIGIBLE turns, not per
 *                  thousand impressions.
 *
 * ZERO DENOMINATORS: every rate (eligible_rate, fill_rate, ctr, rpm) is `null` when its
 * denominator is 0 - a rate over nothing is unknown, not 0%, and the pages render it as "-".
 * Every count and every sum (turns, serves, impressions, clicks, revenue) is 0 instead.
 * ------------------------------------------------------------------------------------------
 */

/** The suppress reason that means demand was asked and returned nothing (docs/api.md). */
export const NO_FILL_REASON = 'no_fill';

/** Prefix of the per-category reasons; metrics.test.ts pins it to the schema's own constant. */
export const SENSITIVE_REASON_PREFIX = 'sensitive_category:';

/**
 * One (UTC day, decision, reason) bucket of audit records. `reason` is a SuppressReason as the
 * gateway wrote it, typed as a plain string so a reason this build does not know about is still
 * counted and shown rather than dropped.
 */
export interface DecisionCountRow {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  decision: Decision;
  reason: string | null;
  count: number;
}

/**
 * One (UTC day, event type) bucket of events, joined back to the audit record they belong to.
 * Events are attributed to the DAY OF THE TURN, not the day the event arrived, so a click that
 * lands after midnight stays with the impression it belongs to.
 */
export interface EventCountRow {
  day: string;
  type: EventType;
  /** Sum of the ecpm of the creative served on each of those records (0 when it is gone). */
  ecpmTotal: number;
  count: number;
}

/** The half-open window [since, until) a set of metrics covers. */
export interface MetricsWindow {
  since: Date;
  until: Date;
  /** Whole UTC days in the window, so a chart always has the same number of buckets. */
  days: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `2026-09-04` - the UTC calendar day of an instant, the same key the queries group by. */
export const utcDay = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * The last `days` UTC days including the day of `now`: from the start of that first day up to
 * `now`. Starting on a day boundary means the day buckets are whole days and there are exactly
 * `days` of them. `now` is a parameter, never a clock read: this module stays pure.
 */
export const metricsWindow = (now: Date, days: number): MetricsWindow => {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { since: new Date(startOfToday - (days - 1) * DAY_MS), until: now, days };
};

/** x / y, or null when y is 0: a rate with no denominator is unknown, not zero. */
const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const total = (rows: readonly { count: number }[]): number =>
  rows.reduce((sum, row) => sum + row.count, 0);

/** True when the turn reached demand: see ad_eligible in the header. */
export const isAdEligible = (row: Pick<DecisionCountRow, 'decision' | 'reason'>): boolean =>
  row.decision === 'serve' || row.reason === NO_FILL_REASON;

/** True for the `sensitive_category:<name>` reasons, whatever the category is called. */
export const isSensitiveReason = (reason: string | null): boolean =>
  reason !== null && reason.startsWith(SENSITIVE_REASON_PREFIX);

export interface AppMetrics {
  turnsEvaluated: number;
  adEligible: number;
  /** null when no turns were evaluated. */
  eligibleRate: number | null;
  serves: number;
  suppressions: number;
  /** null when nothing was eligible. */
  fillRate: number | null;
  impressions: number;
  clicks: number;
  /** null when there were no impressions. */
  ctr: number | null;
  /** Sum of ecpm / 1000 over the impressions. 0 when there are none. */
  estimatedRevenue: number;
  /** Revenue per 1000 eligible turns; null when nothing was eligible. */
  rpm: number | null;
}

/** Every number on the overview, from the two grouped row sets. */
export const computeMetrics = (
  decisions: readonly DecisionCountRow[],
  events: readonly EventCountRow[],
): AppMetrics => {
  const turnsEvaluated = total(decisions);
  const serves = total(decisions.filter((row) => row.decision === 'serve'));
  const adEligible = total(decisions.filter(isAdEligible));
  const impressionRows = events.filter((row) => row.type === 'impression');
  const impressions = total(impressionRows);
  const clicks = total(events.filter((row) => row.type === 'click'));
  const estimatedRevenue = impressionRows.reduce((sum, row) => sum + row.ecpmTotal / 1000, 0);
  const rpm = ratio(estimatedRevenue, adEligible);
  return {
    turnsEvaluated,
    adEligible,
    eligibleRate: ratio(adEligible, turnsEvaluated),
    serves,
    suppressions: turnsEvaluated - serves,
    fillRate: ratio(serves, adEligible),
    impressions,
    clicks,
    ctr: ratio(clicks, impressions),
    estimatedRevenue,
    rpm: rpm === null ? null : rpm * 1000,
  };
};

export interface SuppressReasonCount {
  reason: string;
  count: number;
  /** True for a `sensitive_category:<name>` reason, so a chart can colour the group. */
  sensitive: boolean;
}

export interface SuppressBreakdown {
  /** Every suppress reason seen, biggest first, ties broken alphabetically. */
  reasons: SuppressReasonCount[];
  /** All the `sensitive_category:<name>` reasons added together. */
  sensitiveTotal: number;
  /** Every suppression, whatever the reason. */
  total: number;
}

/**
 * Suppressions grouped by reason. The `sensitive_category:<name>` reasons appear individually
 * in `reasons` AND added up in `sensitiveTotal` - which category was hit matters to an operator
 * tuning a policy, and the total matters to an advertiser who was promised zero exposure.
 * A suppress row whose reason is null (which the contract never produces) is counted under
 * `unknown` rather than dropped, so the breakdown always adds up to `total`.
 */
export const suppressBreakdown = (decisions: readonly DecisionCountRow[]): SuppressBreakdown => {
  const counts = new Map<string, number>();
  let sensitiveTotal = 0;
  let totalCount = 0;
  for (const row of decisions) {
    if (row.decision !== 'suppress') {
      continue;
    }
    const reason = row.reason ?? 'unknown';
    counts.set(reason, (counts.get(reason) ?? 0) + row.count);
    totalCount += row.count;
    if (isSensitiveReason(row.reason)) {
      sensitiveTotal += row.count;
    }
  }
  const reasons = [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, sensitive: isSensitiveReason(reason) }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return { reasons, sensitiveTotal, total: totalCount };
};

export interface DailyDecisions {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  serve: number;
  suppress: number;
}

/**
 * One bucket per UTC day of the window, oldest first, INCLUDING the days with no traffic - a
 * chart with gaps in the middle lies about the shape of the traffic. Rows outside the window
 * are ignored, so the series always has exactly `window.days` points.
 */
export const decisionsPerDay = (
  decisions: readonly DecisionCountRow[],
  window: MetricsWindow,
): DailyDecisions[] => {
  const buckets = new Map<string, DailyDecisions>();
  for (let index = 0; index < window.days; index += 1) {
    const day = utcDay(new Date(window.since.getTime() + index * DAY_MS));
    buckets.set(day, { day, serve: 0, suppress: 0 });
  }
  for (const row of decisions) {
    const bucket = buckets.get(row.day);
    if (bucket !== undefined) {
      bucket[row.decision] += row.count;
    }
  }
  return [...buckets.values()];
};

export interface GlobalMetrics extends AppMetrics {
  /** Apps that have written at least one audit record, ever: integration is a one-way fact. */
  appsIntegrated: number;
  /** Advertisers with at least one generated verification report (S35 writes them). */
  advertisersWithReport: number;
}

/** The /apps header: the windowed metrics across every app plus the two all-time counts. */
export const computeGlobalMetrics = (input: {
  decisions: readonly DecisionCountRow[];
  events: readonly EventCountRow[];
  appsIntegrated: number;
  advertisersWithReport: number;
}): GlobalMetrics => ({
  ...computeMetrics(input.decisions, input.events),
  appsIntegrated: input.appsIntegrated,
  advertisersWithReport: input.advertisersWithReport,
});
