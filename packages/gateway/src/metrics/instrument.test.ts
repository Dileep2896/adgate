import type { DemandTrace } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import {
  attestResult,
  createGatewayMetrics,
  type GatewayMetricsOptions,
  OTHER_ROUTE,
  routeLabel,
} from './instrument.js';
import { createMetricsRegistry, type MetricsRegistry } from './registry.js';
import { parseExposition } from './test-support.js';

const trace = (responses: { source: string; latency_ms: number }[]): DemandTrace =>
  ({
    requested: responses.map((response) => response.source),
    responses: responses.map((response) => ({ ...response, candidates: 0 })),
    excluded: [],
    selected: null,
  }) as DemandTrace;

const scrape = (registry: MetricsRegistry) => parseExposition(registry.render());

describe('routeLabel', () => {
  it('maps a path to its route pattern, never to the path itself', () => {
    expect(routeLabel('/healthz')).toBe('/healthz');
    expect(routeLabel('/metrics')).toBe('/metrics');
    expect(routeLabel('/v1/evaluate')).toBe('/v1/evaluate');
    expect(routeLabel('/v1/audit/aud_01H0')).toBe('/v1/audit/:id');
    expect(routeLabel('/v1/verify/aud_01H0')).toBe('/v1/verify/:id');
    expect(routeLabel('/c/aud_01H0')).toBe('/c/:audit_id');
  });

  it('sends everything else to one bounded bucket', () => {
    for (const path of ['/', '/nope', '/v1/audit/', '/c/', '/v1/audit', '/wp-admin.php']) {
      expect(routeLabel(path), path).toBe(OTHER_ROUTE);
    }
  });
});

describe('attestResult', () => {
  it('names each documented attest outcome', () => {
    expect(attestResult(204)).toBe('ok');
    expect(attestResult(400)).toBe('invalid_request');
    expect(attestResult(401)).toBe('unauthorized');
    expect(attestResult(403)).toBe('unauthorized');
    expect(attestResult(404)).toBe('not_found');
    expect(attestResult(409)).toBe('already_attested');
    expect(attestResult(429)).toBe('rate_limited');
    expect(attestResult(500)).toBe('error');
  });
});

describe('createGatewayMetrics', () => {
  const metricsWith = (options: GatewayMetricsOptions = {}) => {
    const registry = options.registry ?? createMetricsRegistry();
    return { registry, metrics: createGatewayMetrics({ ...options, registry }) };
  };

  it('records the decision, the duration in seconds, the cache result and every adapter', () => {
    const { registry, metrics } = metricsWith();
    metrics.recordEvaluation({
      decision: 'serve',
      reason: null,
      durationMs: 42,
      cacheSource: 'miss',
      demand: trace([
        { source: 'direct', latency_ms: 12 },
        { source: 'affiliate', latency_ms: 1 },
      ]),
    });
    metrics.recordEvaluation({
      decision: 'suppress',
      reason: 'paid_user',
      durationMs: 3,
      cacheSource: 'lru',
    });

    const parsed = scrape(registry);
    expect(parsed.value('adgate_decisions_total', { decision: 'serve', reason: 'none' })).toBe(1);
    expect(
      parsed.value('adgate_decisions_total', { decision: 'suppress', reason: 'paid_user' }),
    ).toBe(1);
    expect(parsed.value('adgate_evaluate_duration_seconds_count')).toBe(2);
    expect(parsed.value('adgate_evaluate_duration_seconds_sum')).toBeCloseTo(0.045, 6);
    expect(parsed.value('adgate_evaluate_duration_seconds_bucket', { le: '0.05' })).toBe(2);
    expect(parsed.value('adgate_demand_adapter_duration_seconds_count', { source: 'direct' })).toBe(
      1,
    );
    expect(
      parsed.value('adgate_demand_adapter_duration_seconds_sum', { source: 'affiliate' }),
    ).toBeCloseTo(0.001, 6);
    expect(parsed.value('adgate_classify_cache_total', { result: 'miss' })).toBe(1);
    expect(parsed.value('adgate_classify_cache_total', { result: 'hit_memory' })).toBe(1);
  });

  it('maps the Postgres cache tier to hit_postgres and records nothing without a source', () => {
    const { registry, metrics } = metricsWith();
    metrics.recordEvaluation({ decision: 'suppress', reason: 'error', durationMs: 1 });
    metrics.recordEvaluation({
      decision: 'serve',
      reason: null,
      durationMs: 1,
      cacheSource: 'pg',
    });
    const parsed = scrape(registry);
    expect(parsed.value('adgate_classify_cache_total', { result: 'hit_postgres' })).toBe(1);
    expect(parsed.family('adgate_classify_cache_total').samples).toHaveLength(1);
  });

  it('swallows a failure inside the registry instead of raising it into the request', () => {
    const broken: MetricsRegistry = {
      counter: () => ({
        inc: () => {
          throw new Error('metric exploded');
        },
      }),
      histogram: () => ({
        observe: () => {
          throw new Error('metric exploded');
        },
      }),
      gauge: () => undefined,
      render: () => '',
    };
    const metrics = createGatewayMetrics({ registry: broken });
    expect(() =>
      metrics.recordEvaluation({ decision: 'serve', reason: null, durationMs: 1 }),
    ).not.toThrow();
    expect(() => metrics.recordHttpRequest('/v1/attest', 429)).not.toThrow();
  });
});
