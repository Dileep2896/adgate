import { DecisionsChart } from '@/components/charts/decisions-chart';
import { ReasonsChart } from '@/components/charts/reasons-chart';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import { formatAmount, formatCount, formatPercent } from '@/lib/format';
import type { AppMetrics, DailyDecisions, SuppressBreakdown } from '@/lib/metrics';

/**
 * One app's last N days: the eight numbers, then the two charts.
 *
 * Server rendered. The charts are the only client components on the page and they receive plain
 * arrays that lib/metrics.ts has already computed, so the browser bundle gets recharts and
 * nothing else - no Drizzle, no policy schema, no @adgate/core.
 *
 * Every rate can be `-`, which means its denominator was 0 (lib/metrics.ts). The hints say what
 * each rate is over, because "66.7% fill" over six eligible turns is not the same claim as
 * 66.7% over six thousand.
 */

export interface AppOverviewProps {
  metrics: AppMetrics;
  daily: DailyDecisions[];
  breakdown: SuppressBreakdown;
  /** Days in the window, for the heading. */
  days: number;
}

const overviewMetrics = (metrics: AppMetrics): Metric[] => [
  {
    label: 'Turns evaluated',
    value: formatCount(metrics.turnsEvaluated),
    hint: `${formatCount(metrics.serves)} served, ${formatCount(metrics.suppressions)} suppressed`,
    testId: 'metric-turns',
  },
  {
    label: 'Ad eligible',
    value: formatPercent(metrics.eligibleRate),
    hint: `${formatCount(metrics.adEligible)} turns reached demand`,
    testId: 'metric-eligible-rate',
  },
  {
    label: 'Fill rate',
    value: formatPercent(metrics.fillRate),
    hint: `${formatCount(metrics.serves)} of ${formatCount(metrics.adEligible)} eligible`,
    testId: 'metric-fill-rate',
  },
  {
    label: 'Impressions',
    value: formatCount(metrics.impressions),
    hint: 'attested renders',
    testId: 'metric-impressions',
  },
  { label: 'Clicks', value: formatCount(metrics.clicks), testId: 'metric-clicks' },
  {
    label: 'CTR',
    value: formatPercent(metrics.ctr),
    hint: `${formatCount(metrics.clicks)} of ${formatCount(metrics.impressions)} impressions`,
    testId: 'metric-ctr',
  },
  {
    label: 'Est. revenue',
    value: formatAmount(metrics.estimatedRevenue),
    hint: 'sum of ecpm / 1000 per impression',
    testId: 'metric-revenue',
  },
  {
    label: 'RPM',
    value: formatAmount(metrics.rpm),
    hint: 'per 1000 eligible turns',
    testId: 'metric-rpm',
  },
];

export const AppOverview = ({ metrics, daily, breakdown, days }: AppOverviewProps) => (
  <section data-testid="app-overview" className="space-y-4">
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-sm font-semibold text-stone-900">Last {days} days</h2>
      <p className="text-xs text-stone-500">
        Eligible = the policy allowed an ad and demand was asked (served or no_fill).
      </p>
    </div>

    <MetricGrid metrics={overviewMetrics(metrics)} />

    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card">
        <h3 className="mb-2 text-sm font-semibold text-stone-900">Decisions per day</h3>
        <DecisionsChart data={daily} />
        {metrics.turnsEvaluated === 0 ? (
          <p data-testid="no-decisions" className="mt-2 text-xs text-stone-400">
            No turns evaluated in this window yet.
          </p>
        ) : null}
      </div>
      <div className="card">
        <h3 className="mb-2 text-sm font-semibold text-stone-900">Why turns were suppressed</h3>
        <ReasonsChart data={breakdown.reasons} />
        <p data-testid="sensitive-total" className="mt-2 text-xs text-stone-500">
          {formatCount(breakdown.sensitiveTotal)} of {formatCount(breakdown.total)} suppressions
          were a sensitive category.
        </p>
      </div>
    </div>
  </section>
);
