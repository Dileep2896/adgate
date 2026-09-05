'use client';

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatReason } from '@/lib/format';
import type { SuppressReasonCount } from '@/lib/metrics';

/**
 * Why turns were suppressed, biggest reason first, as a horizontal bar per reason.
 *
 * A CLIENT component over already computed data (see decisions-chart.tsx). The
 * `sensitive_category:<name>` reasons are drawn in their own colour, because "how often did we
 * refuse to advertise next to a sensitive topic" is the number an advertiser and a regulator
 * both ask about; the total across them is shown next to the chart by the page.
 *
 * An empty breakdown still renders: the axes appear with no bars, which is the honest picture
 * of an app that suppressed nothing.
 */

export const REASON_COLOR = '#78716c';
export const SENSITIVE_COLOR = '#b45309';
export const ROW_HEIGHT = 28;
export const MIN_HEIGHT = 120;

export interface ReasonsChartProps {
  data: SuppressReasonCount[];
  /** Fixed pixel width instead of filling the container; only the unit test passes it. */
  width?: number;
  height?: number;
}

export const ReasonsChart = ({ data, width, height }: ReasonsChartProps) => {
  const chartHeight = height ?? Math.max(MIN_HEIGHT, data.length * ROW_HEIGHT + 40);
  const chart = (
    <BarChart
      data={data}
      layout="vertical"
      margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
      {...(width === undefined ? {} : { width, height: chartHeight })}
    >
      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
      <YAxis
        type="category"
        dataKey="reason"
        tickFormatter={formatReason}
        tick={{ fontSize: 11 }}
        width={150}
      />
      <Tooltip cursor={{ fill: '#f5f5f4' }} />
      <Bar dataKey="count" name="Turns" isAnimationActive={false}>
        {data.map((row) => (
          <Cell key={row.reason} fill={row.sensitive ? SENSITIVE_COLOR : REASON_COLOR} />
        ))}
      </Bar>
    </BarChart>
  );

  return (
    <div data-testid="reasons-chart">
      {width === undefined ? (
        <ResponsiveContainer width="100%" height={chartHeight}>
          {chart}
        </ResponsiveContainer>
      ) : (
        chart
      )}
    </div>
  );
};
