/**
 * A row of headline numbers. Presentational and server rendered: it is handed strings that
 * lib/format.ts has already produced, so it holds no arithmetic and no formatting rules of its
 * own. `-` is a real value here - it is what a rate with no denominator looks like.
 */

export interface Metric {
  label: string;
  /** Already formatted (lib/format.ts). */
  value: string;
  /** One short line under the number: what it is divided by, or the raw counts behind it. */
  hint?: string;
  /** Goes on the value, so a test can assert the number and not the label around it. */
  testId?: string;
}

export interface MetricGridProps {
  metrics: Metric[];
}

export const MetricGrid = ({ metrics }: MetricGridProps) => (
  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    {metrics.map((metric) => (
      <div key={metric.label} className="card">
        <dt className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
          {metric.label}
        </dt>
        <dd
          data-testid={metric.testId}
          className="mt-1 text-xl font-semibold tabular-nums text-stone-900"
        >
          {metric.value}
        </dd>
        {metric.hint === undefined ? null : (
          <dd className="mt-0.5 text-xs text-stone-400">{metric.hint}</dd>
        )}
      </div>
    ))}
  </dl>
);
