import { describe, expect, it } from 'vitest';

import { escapeLabelValue, formatValue, METRIC_NAME_PATTERN } from './exposition.js';
import { createMetricsRegistry, MAX_SERIES_PER_METRIC, SERIES_DROPPED_METRIC } from './registry.js';
import { parseExposition } from './test-support.js';

const BUCKETS = [0.01, 0.1, 1];

describe('createMetricsRegistry', () => {
  it('renders a body every scraper can parse, with HELP and TYPE before the samples', () => {
    const registry = createMetricsRegistry();
    const decisions = registry.counter({
      name: 'adgate_decisions_total',
      help: 'Decisions.',
      labelNames: ['decision', 'reason'],
    });
    decisions.inc({ decision: 'serve', reason: 'none' });
    decisions.inc({ decision: 'suppress', reason: 'paid_user' });
    decisions.inc({ decision: 'serve', reason: 'none' });

    const body = registry.render();
    const lines = body.split('\n');
    const help = lines.indexOf('# HELP adgate_decisions_total Decisions.');
    expect(help).toBeGreaterThanOrEqual(0);
    expect(lines[help + 1]).toBe('# TYPE adgate_decisions_total counter');
    expect(lines[help + 2]).toMatch(/^adgate_decisions_total\{/);

    const parsed = parseExposition(body);
    expect(parsed.family('adgate_decisions_total').type).toBe('counter');
    expect(parsed.value('adgate_decisions_total', { decision: 'serve', reason: 'none' })).toBe(2);
    expect(
      parsed.value('adgate_decisions_total', { decision: 'suppress', reason: 'paid_user' }),
    ).toBe(1);
    for (const family of parsed.families.keys()) {
      expect(family).toMatch(METRIC_NAME_PATTERN);
    }
  });

  it('renders a histogram with cumulative buckets, +Inf, _sum and _count', () => {
    const registry = createMetricsRegistry();
    const latency = registry.histogram({
      name: 'adgate_evaluate_duration_seconds',
      help: 'Latency.',
      buckets: BUCKETS,
    });
    latency.observe(0.005);
    latency.observe(0.05);
    latency.observe(4);

    const parsed = parseExposition(registry.render());
    const at = (le: string): number | undefined =>
      parsed.value('adgate_evaluate_duration_seconds_bucket', { le });
    expect(at('0.01')).toBe(1);
    expect(at('0.1')).toBe(2);
    expect(at('1')).toBe(2);
    expect(at('+Inf')).toBe(3);
    expect(parsed.value('adgate_evaluate_duration_seconds_count')).toBe(3);
    expect(parsed.value('adgate_evaluate_duration_seconds_sum')).toBeCloseTo(4.055, 6);
  });

  it('keeps histogram series apart by label', () => {
    const registry = createMetricsRegistry();
    const adapter = registry.histogram({
      name: 'adgate_demand_adapter_duration_seconds',
      help: 'Adapters.',
      labelNames: ['source'],
      buckets: BUCKETS,
    });
    adapter.observe(0.005, { source: 'direct' });
    adapter.observe(0.5, { source: 'affiliate' });

    const parsed = parseExposition(registry.render());
    const count = (source: string): number | undefined =>
      parsed.value('adgate_demand_adapter_duration_seconds_count', { source });
    expect(count('direct')).toBe(1);
    expect(count('affiliate')).toBe(1);
    expect(
      parsed.value('adgate_demand_adapter_duration_seconds_bucket', {
        source: 'affiliate',
        le: '0.1',
      }),
    ).toBe(0);
  });

  it('reads a gauge at scrape time', () => {
    const registry = createMetricsRegistry();
    let seconds = 1;
    registry.gauge({
      name: 'adgate_process_uptime_seconds',
      help: 'Uptime.',
      collect: () => seconds,
    });
    expect(parseExposition(registry.render()).value('adgate_process_uptime_seconds')).toBe(1);
    seconds = 42;
    expect(parseExposition(registry.render()).value('adgate_process_uptime_seconds')).toBe(42);
  });

  it('stops at MAX_SERIES_PER_METRIC and counts what it dropped', () => {
    const registry = createMetricsRegistry();
    const counter = registry.counter({
      name: 'adgate_test_total',
      help: 'Test.',
      labelNames: ['id'],
    });
    for (let i = 0; i < MAX_SERIES_PER_METRIC + 10; i += 1) {
      counter.inc({ id: `series_${i}` });
    }
    const parsed = parseExposition(registry.render());
    expect(parsed.family('adgate_test_total').samples).toHaveLength(MAX_SERIES_PER_METRIC);
    expect(parsed.value(SERIES_DROPPED_METRIC)).toBe(10);
    // The series that did fit keep counting.
    counter.inc({ id: 'series_0' });
    expect(parseExposition(registry.render()).value('adgate_test_total', { id: 'series_0' })).toBe(
      2,
    );
  });

  it('always renders the drop counter, at zero when nothing was dropped', () => {
    expect(parseExposition(createMetricsRegistry().render()).value(SERIES_DROPPED_METRIC)).toBe(0);
  });

  it('rejects an invalid name and a duplicate registration', () => {
    const registry = createMetricsRegistry();
    expect(() => registry.counter({ name: 'has-a-dash', help: 'No.' })).toThrow(
      /invalid metric name/,
    );
    expect(() =>
      registry.counter({ name: 'adgate_ok_total', help: 'Yes.', labelNames: ['__reserved'] }),
    ).toThrow(/invalid label name/);
    registry.counter({ name: 'adgate_twice_total', help: 'Once.' });
    expect(() => registry.counter({ name: 'adgate_twice_total', help: 'Twice.' })).toThrow(
      /already registered/,
    );
    expect(() =>
      registry.histogram({ name: 'adgate_bad_seconds', help: 'Bad.', buckets: [1, 0.5] }),
    ).toThrow(/ascending/);
  });

  it('ignores an observation that is not a finite number', () => {
    const registry = createMetricsRegistry();
    const latency = registry.histogram({ name: 'adgate_h_seconds', help: 'H.', buckets: BUCKETS });
    latency.observe(Number.NaN);
    latency.observe(Number.POSITIVE_INFINITY);
    latency.observe(-1);
    const parsed = parseExposition(registry.render());
    expect(parsed.family('adgate_h_seconds').samples).toHaveLength(0);
  });

  it('escapes label values and help text so the body stays parseable', () => {
    const registry = createMetricsRegistry();
    const counter = registry.counter({
      name: 'adgate_escape_total',
      help: 'Quotes " and\nnewlines.',
      labelNames: ['value'],
    });
    counter.inc({ value: 'a"b\\c\nd' });
    const body = registry.render();
    expect(body).toContain('a\\"b\\\\c\\nd');
    expect(parseExposition(body).value('adgate_escape_total', { value: 'a"b\\c\nd' })).toBe(1);
  });
});

describe('exposition helpers', () => {
  it('formats values the way Prometheus reads them', () => {
    expect(formatValue(0)).toBe('0');
    expect(formatValue(1)).toBe('1');
    expect(formatValue(0.0421)).toBe('0.0421');
    expect(formatValue(Number.POSITIVE_INFINITY)).toBe('+Inf');
    expect(formatValue(Number.NaN)).toBe('NaN');
  });

  it('escapes only backslash, newline and double quote in a label value', () => {
    expect(escapeLabelValue('plain')).toBe('plain');
    expect(escapeLabelValue('a\\b')).toBe('a\\\\b');
    expect(escapeLabelValue('a"b')).toBe('a\\"b');
    expect(escapeLabelValue('a\nb')).toBe('a\\nb');
  });
});

describe('parseExposition', () => {
  it('refuses a sample whose family was never declared', () => {
    expect(() => parseExposition('adgate_orphan_total 1\n')).toThrow(/# HELP/);
  });

  it('refuses buckets that are not cumulative or do not end at +Inf', () => {
    const header = '# HELP h Help.\n# TYPE h histogram\n';
    expect(() =>
      parseExposition(`${header}h_bucket{le="1"} 2\nh_bucket{le="+Inf"} 1\nh_sum 1\nh_count 1\n`),
    ).toThrow(/cumulative/);
    expect(() => parseExposition(`${header}h_bucket{le="1"} 1\nh_sum 1\nh_count 1\n`)).toThrow(
      /\+Inf/,
    );
    expect(() =>
      parseExposition(`${header}h_bucket{le="1"} 1\nh_bucket{le="+Inf"} 2\nh_sum 1\nh_count 1\n`),
    ).toThrow(/disagree/);
  });
});
