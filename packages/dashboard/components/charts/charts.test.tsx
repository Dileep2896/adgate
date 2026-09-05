// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DailyDecisions, SuppressReasonCount } from '@/lib/metrics';

import { DecisionsChart } from './decisions-chart';
import { REASON_COLOR, ReasonsChart, SENSITIVE_COLOR } from './reasons-chart';

/**
 * The charts must survive an app with no traffic - the state EVERY app is in on the day it is
 * registered, and the one an operator is most likely to look at first.
 *
 * Both are rendered at a FIXED width here: jsdom has no layout, so ResponsiveContainer would
 * measure 0 pixels and skip its child, and the test would prove nothing. With a width recharts
 * really does build the chart, so an empty series has to go all the way through it.
 */

const WIDTH = 480;

/** One wrapper per rendered chart; recharts draws several nested svg surfaces inside it. */
const charts = (container: HTMLElement): NodeListOf<Element> =>
  container.querySelectorAll('.recharts-wrapper');

/** The <path> recharts draws for one bar. Animation is off, so they are there on first render. */
const bars = (container: HTMLElement): Element[] => [
  ...container.querySelectorAll('.recharts-bar-rectangle path'),
];

afterEach(cleanup);

describe('DecisionsChart', () => {
  it('renders an empty series without throwing', () => {
    const { container } = render(<DecisionsChart data={[]} width={WIDTH} />);
    expect(charts(container)).toHaveLength(1);
    expect(bars(container)).toHaveLength(0);
  });

  it('renders a bar for each day that has decisions', () => {
    const data: DailyDecisions[] = [
      { day: '2026-09-02', serve: 2, suppress: 1 },
      { day: '2026-09-03', serve: 0, suppress: 4 },
    ];
    const { container } = render(<DecisionsChart data={data} width={WIDTH} />);
    expect(charts(container)).toHaveLength(1);
    // Three non-zero segments: 2 served and 1 suppressed on the 2nd, 4 suppressed on the 3rd.
    // A zero value draws no rectangle at all, which is why the quiet-window case below is 0.
    expect(bars(container)).toHaveLength(3);
  });

  it('renders the quiet days of a full window as empty buckets', () => {
    const data: DailyDecisions[] = Array.from({ length: 30 }, (_unused, index) => ({
      day: `2026-08-${String(index + 1).padStart(2, '0')}`,
      serve: 0,
      suppress: 0,
    }));
    const { container } = render(<DecisionsChart data={data} width={WIDTH} />);
    expect(charts(container)).toHaveLength(1);
    expect(bars(container)).toHaveLength(0);
  });
});

describe('ReasonsChart', () => {
  it('renders an empty breakdown without throwing', () => {
    const { container } = render(<ReasonsChart data={[]} width={WIDTH} />);
    expect(charts(container)).toHaveLength(1);
    expect(bars(container)).toHaveLength(0);
  });

  it('draws the sensitive reasons in their own colour', () => {
    const data: SuppressReasonCount[] = [
      { reason: 'frequency_cap', count: 9, sensitive: false },
      { reason: 'sensitive_category:health', count: 3, sensitive: true },
    ];
    const { container } = render(<ReasonsChart data={data} width={WIDTH} />);
    expect(bars(container).map((node) => node.getAttribute('fill'))).toEqual([
      REASON_COLOR,
      SENSITIVE_COLOR,
    ]);
  });
});
