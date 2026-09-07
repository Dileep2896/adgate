import {
  FIXED_SUPPRESS_REASONS,
  POLICY_RULES,
  SENSITIVE_CATEGORY_REASON_PREFIX,
} from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import {
  computeGlobalMetrics,
  computeMetrics,
  decisionsPerDay,
  isAdEligible,
  metricsWindow,
  NO_FILL_REASON,
  SENSITIVE_REASON_PREFIX,
  suppressBreakdown,
  utcDay,
  type DecisionCountRow,
  type EventCountRow,
} from './metrics';

/**
 * THE FIXTURE IS HAND WRITTEN AND SO ARE THE EXPECTED NUMBERS. Every count below is round on
 * purpose so the assertions can be checked by eye:
 *
 *   turns           10 + 5 + 12 + 30 + 8 + 5 + 5 + 25 = 100
 *   serves          10 + 30                           =  40
 *   eligible        40 serves + 5 no_fill             =  45   -> 45%
 *   suppressions    100 - 40                          =  60
 *   fill rate       40 / 45                           = 8/9
 *   impressions     8 + 12                            =  20
 *   clicks                                            =   5   -> CTR 25%
 *   revenue         (160 + 240) / 1000                = 0.40  (the click row's ecpm is ignored)
 *   RPM             0.40 / 45 * 1000                  = 80/9
 *
 * The window is three days so the daily series is short enough to write out in full.
 */

const NOW = new Date('2026-09-04T12:00:00.000Z');
const WINDOW = metricsWindow(NOW, 3);

const DECISIONS: DecisionCountRow[] = [
  { day: '2026-09-02', decision: 'serve', reason: null, count: 10 },
  { day: '2026-09-02', decision: 'suppress', reason: 'no_fill', count: 5 },
  { day: '2026-09-02', decision: 'suppress', reason: 'paid_user', count: 12 },
  { day: '2026-09-03', decision: 'serve', reason: null, count: 30 },
  { day: '2026-09-03', decision: 'suppress', reason: 'paid_user', count: 8 },
  { day: '2026-09-03', decision: 'suppress', reason: 'sensitive_category:health', count: 5 },
  { day: '2026-09-03', decision: 'suppress', reason: 'sensitive_category:finance', count: 5 },
  { day: '2026-09-04', decision: 'suppress', reason: 'frequency_cap', count: 25 },
];

const EVENTS: EventCountRow[] = [
  // 8 impressions on creatives worth 20.0 ecpm each: 8 * 20 = 160.
  { day: '2026-09-02', type: 'impression', count: 8, ecpmTotal: 160 },
  // 12 more the next day: 12 * 20 = 240.
  { day: '2026-09-03', type: 'impression', count: 12, ecpmTotal: 240 },
  // The query sums ecpm for every event type; only impressions may earn. 999 must be ignored.
  { day: '2026-09-03', type: 'click', count: 5, ecpmTotal: 999 },
  { day: '2026-09-03', type: 'dismiss', count: 2, ecpmTotal: 40 },
];

describe('the reason constants', () => {
  it('come from the contract, not from a copy that can drift', () => {
    expect(FIXED_SUPPRESS_REASONS).toContain(NO_FILL_REASON);
    expect(SENSITIVE_REASON_PREFIX).toBe(SENSITIVE_CATEGORY_REASON_PREFIX);
  });

  it('treat every rule that runs before demand as NOT eligible', () => {
    // frequency_caps is the last rule before the gateway asks demand for a creative, so a turn
    // is eligible only when it got past all of them: serve, or suppress with reason no_fill.
    expect(POLICY_RULES.at(-2)).toBe('frequency_caps');
    for (const reason of FIXED_SUPPRESS_REASONS) {
      expect(isAdEligible({ decision: 'suppress', reason })).toBe(reason === NO_FILL_REASON);
    }
    expect(isAdEligible({ decision: 'suppress', reason: 'sensitive_category:health' })).toBe(false);
    expect(isAdEligible({ decision: 'serve', reason: null })).toBe(true);
  });
});

describe('metricsWindow', () => {
  it('starts at the beginning of the first UTC day and ends at now', () => {
    expect(WINDOW.since.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(WINDOW.until).toBe(NOW);
    expect(WINDOW.days).toBe(3);
    expect(utcDay(WINDOW.since)).toBe('2026-09-02');
  });

  it('covers 30 whole days by default usage', () => {
    const month = metricsWindow(new Date('2026-09-04T00:00:00.000Z'), 30);
    expect(month.since.toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });
});

describe('computeMetrics over the fixture', () => {
  const metrics = computeMetrics(DECISIONS, EVENTS);

  it('counts every turn once', () => {
    expect(metrics.turnsEvaluated).toBe(100);
    expect(metrics.serves).toBe(40);
    expect(metrics.suppressions).toBe(60);
  });

  it('counts the eligible turns as serves plus no_fill', () => {
    expect(metrics.adEligible).toBe(45);
    expect(metrics.eligibleRate).toBe(0.45);
  });

  it('divides serves by eligible turns for the fill rate', () => {
    expect(metrics.fillRate).toBeCloseTo(8 / 9, 12);
  });

  it('counts impressions and clicks and divides them for CTR', () => {
    expect(metrics.impressions).toBe(20);
    expect(metrics.clicks).toBe(5);
    expect(metrics.ctr).toBe(0.25);
  });

  it('sums ecpm / 1000 over the impressions only', () => {
    expect(metrics.estimatedRevenue).toBeCloseTo(0.4, 12);
  });

  it('reports revenue per thousand ELIGIBLE turns', () => {
    expect(metrics.rpm).toBeCloseTo(80 / 9, 12);
  });
});

describe('empty data', () => {
  const metrics = computeMetrics([], []);

  it('returns 0 for every count and null for every rate', () => {
    expect(metrics).toEqual({
      turnsEvaluated: 0,
      adEligible: 0,
      eligibleRate: null,
      serves: 0,
      suppressions: 0,
      fillRate: null,
      impressions: 0,
      clicks: 0,
      ctr: null,
      estimatedRevenue: 0,
      rpm: null,
    });
  });

  it('still returns one bucket per day of the window', () => {
    expect(decisionsPerDay([], WINDOW)).toEqual([
      { day: '2026-09-02', serve: 0, suppress: 0 },
      { day: '2026-09-03', serve: 0, suppress: 0 },
      { day: '2026-09-04', serve: 0, suppress: 0 },
    ]);
  });

  it('has an empty suppress breakdown', () => {
    expect(suppressBreakdown([])).toEqual({ reasons: [], sensitiveTotal: 0, total: 0 });
  });

  it('keeps the fill rate null when nothing was eligible but turns happened', () => {
    const blocked: DecisionCountRow[] = [
      { day: '2026-09-04', decision: 'suppress', reason: 'paid_user', count: 7 },
    ];
    const metrics = computeMetrics(blocked, []);
    expect(metrics.turnsEvaluated).toBe(7);
    expect(metrics.eligibleRate).toBe(0);
    expect(metrics.fillRate).toBeNull();
    expect(metrics.rpm).toBeNull();
    expect(metrics.ctr).toBeNull();
  });
});

describe('suppressBreakdown over the fixture', () => {
  const breakdown = suppressBreakdown(DECISIONS);

  it('adds a reason up across days, biggest first, ties alphabetical', () => {
    expect(breakdown.reasons).toEqual([
      { reason: 'frequency_cap', count: 25, sensitive: false },
      { reason: 'paid_user', count: 20, sensitive: false },
      { reason: 'no_fill', count: 5, sensitive: false },
      { reason: 'sensitive_category:finance', count: 5, sensitive: true },
      { reason: 'sensitive_category:health', count: 5, sensitive: true },
    ]);
  });

  it('also groups the sensitive categories into one total', () => {
    expect(breakdown.sensitiveTotal).toBe(10);
  });

  it('adds up to every suppression', () => {
    expect(breakdown.total).toBe(60);
    expect(breakdown.reasons.reduce((sum, row) => sum + row.count, 0)).toBe(60);
  });

  it('counts a suppression with no reason under "unknown" rather than losing it', () => {
    const rows: DecisionCountRow[] = [
      { day: '2026-09-04', decision: 'suppress', reason: null, count: 3 },
    ];
    expect(suppressBreakdown(rows)).toEqual({
      reasons: [{ reason: 'unknown', count: 3, sensitive: false }],
      sensitiveTotal: 0,
      total: 3,
    });
  });
});

describe('decisionsPerDay over the fixture', () => {
  it('splits serve and suppress by UTC day and fills the quiet day', () => {
    expect(decisionsPerDay(DECISIONS, WINDOW)).toEqual([
      { day: '2026-09-02', serve: 10, suppress: 17 },
      { day: '2026-09-03', serve: 30, suppress: 18 },
      { day: '2026-09-04', serve: 0, suppress: 25 },
    ]);
  });

  it('ignores a day outside the window instead of adding a bucket', () => {
    const outside: DecisionCountRow[] = [
      ...DECISIONS,
      { day: '2026-08-30', decision: 'serve', reason: null, count: 999 },
    ];
    const series = decisionsPerDay(outside, WINDOW);
    expect(series).toHaveLength(3);
    expect(series.map((row) => row.serve)).toEqual([10, 30, 0]);
  });
});

describe('computeGlobalMetrics', () => {
  it('is the same arithmetic plus the two all-time counts', () => {
    const global = computeGlobalMetrics({
      decisions: DECISIONS,
      events: EVENTS,
      appsIntegrated: 3,
      advertisersWithReport: 2,
    });
    expect(global.appsIntegrated).toBe(3);
    expect(global.advertisersWithReport).toBe(2);
    expect(global.turnsEvaluated).toBe(100);
    expect(global.eligibleRate).toBe(0.45);
    expect(global.rpm).toBeCloseTo(80 / 9, 12);
  });
});
