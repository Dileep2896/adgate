'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { DailyDecisions } from '@/lib/metrics';

/**
 * Decisions per UTC day, serve stacked on suppress.
 *
 * A CLIENT component that takes ALREADY COMPUTED plain data. recharts only runs in the browser,
 * and the arithmetic behind these numbers is done on the server (lib/metrics.ts, which this
 * file imports types from and nothing else) - so no query, no Drizzle and no @adgateio/core ever
 * reaches the browser bundle through this import.
 *
 * It renders with an empty series on purpose: lib/metrics.ts always returns one bucket per day
 * of the window, so a quiet app draws a flat axis rather than a broken chart.
 *
 * COLOUR COMES FROM THE THEME, NOT FROM THIS FILE. recharts paints SVG through presentation
 * attributes, and a presentation attribute cannot resolve a CSS custom property - so the bars
 * carry a class and `.ag-chart` in app/globals.css does the painting, where author CSS always
 * outranks an attribute. That is what makes the chart follow light and dark mode. The `fill`
 * props below name the same tokens, so the intent is readable here too.
 *
 * The legend is hand built rather than recharts' own: its swatch is an attribute-painted path,
 * which would be the one thing on the chart that could not follow the theme, and a two item key
 * in the page's own mono label style reads better than the library's.
 */

export const SERVE_COLOR = 'var(--color-chart-serve)';
export const SUPPRESS_COLOR = 'var(--color-chart-suppress)';
export const CHART_HEIGHT = 220;

export interface DecisionsChartProps {
  data: DailyDecisions[];
  /**
   * Fixed pixel width instead of filling the container. Only the unit test passes it: jsdom has
   * no layout, so ResponsiveContainer would measure 0 and never render the chart at all.
   */
  width?: number;
  height?: number;
}

/** `09-04` - the axis has no room for the year and every tick shares it anyway. */
const shortDay = (day: string): string => day.slice(5);

const TOOLTIP_STYLE = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-rule)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-ink)',
  fontSize: 'var(--text-2xs)',
  fontFamily: 'var(--font-mono)',
} as const;

export const DecisionsChart = ({ data, width, height = CHART_HEIGHT }: DecisionsChartProps) => {
  const chart = (
    <BarChart
      data={data}
      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      {...(width === undefined ? {} : { width, height })}
    >
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="day"
        tickFormatter={shortDay}
        tick={{ fontSize: 11 }}
        interval="preserveStartEnd"
      />
      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
      <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: 'var(--color-ink-2)' }} />
      <Bar
        dataKey="serve"
        name="Served"
        stackId="decision"
        className="ag-bar-serve"
        fill={SERVE_COLOR}
        isAnimationActive={false}
      />
      <Bar
        dataKey="suppress"
        name="Suppressed"
        stackId="decision"
        className="ag-bar-suppress"
        fill={SUPPRESS_COLOR}
        isAnimationActive={false}
      />
    </BarChart>
  );

  return (
    <div data-testid="decisions-chart" className="ag-chart">
      {width === undefined ? (
        <ResponsiveContainer width="100%" height={height}>
          {chart}
        </ResponsiveContainer>
      ) : (
        chart
      )}
      <p className="ag-chart-key">
        <span className="ag-chart-swatch ag-swatch-serve" aria-hidden="true" />
        Served
        <span className="ag-chart-swatch ag-swatch-suppress" aria-hidden="true" />
        Suppressed
      </p>
    </div>
  );
};
