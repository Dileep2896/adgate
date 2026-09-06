/**
 * A row of headline numbers. Presentational and server rendered: it is handed strings that
 * lib/format.ts has already produced, so it holds no arithmetic and no formatting rules of its
 * own. `-` is a real value here - it is what a rate with no denominator looks like.
 *
 * Drawn as ONE bordered instrument panel divided by hairlines rather than as a row of
 * identical cards: the 1px grid gap is the panel's own background showing through, so no
 * cell owns a border and the leading figure can be set larger than the rest without the
 * row falling apart. `auto-fit` means five numbers and eight numbers both fill the strip.
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
  <dl className="ag-metrics">
    {metrics.map((metric) => (
      <div key={metric.label} className="ag-metric">
        <dt className="ag-metric-label">{metric.label}</dt>
        <dd data-testid={metric.testId} className="ag-metric-value">
          {metric.value}
        </dd>
        {metric.hint === undefined ? null : <dd className="ag-metric-hint">{metric.hint}</dd>}
      </div>
    ))}
  </dl>
);
