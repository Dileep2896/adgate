'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { DailyDecisions } from '@/lib/metrics';

/**
 * Decisions per UTC day, serve stacked on suppress.
 *
 * A CLIENT component that takes ALREADY COMPUTED plain data. recharts only runs in the browser,
 * and the arithmetic behind these numbers is done on the server (lib/metrics.ts, which this
 * file imports types from and nothing else) - so no query, no Drizzle and no @adgate/core ever
 * reaches the browser bundle through this import.
 *
 * It renders with an empty series on purpose: lib/metrics.ts always returns one bucket per day
 * of the window, so a quiet app draws a flat axis rather than a broken chart.
 */

export const SERVE_COLOR = '#0f766e';
export const SUPPRESS_COLOR = '#d6d3d1';
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

export const DecisionsChart = ({ data, width, height = CHART_HEIGHT }: DecisionsChartProps) => {
  const chart = (
    <BarChart
      data={data}
      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      {...(width === undefined ? {} : { width, height })}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
      <XAxis
        dataKey="day"
        tickFormatter={shortDay}
        tick={{ fontSize: 11 }}
        interval="preserveStartEnd"
      />
      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
      <Tooltip cursor={{ fill: '#f5f5f4' }} />
      <Legend wrapperStyle={{ fontSize: 12 }} />
      <Bar
        dataKey="serve"
        name="Served"
        stackId="decision"
        fill={SERVE_COLOR}
        isAnimationActive={false}
      />
      <Bar
        dataKey="suppress"
        name="Suppressed"
        stackId="decision"
        fill={SUPPRESS_COLOR}
        isAnimationActive={false}
      />
    </BarChart>
  );

  return (
    <div data-testid="decisions-chart">
      {width === undefined ? (
        <ResponsiveContainer width="100%" height={height}>
          {chart}
        </ResponsiveContainer>
      ) : (
        chart
      )}
    </div>
  );
};
