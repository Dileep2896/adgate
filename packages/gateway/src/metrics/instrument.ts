import type { Clock } from '@adgateio/core';
import type { Decision, DemandTrace, SuppressReason } from '@adgateio/schemas';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../app-env.js';
import type { CacheSource } from '../evaluate/classify-cache-pg.js';
import { createMetricsRegistry, type MetricsRegistry } from './registry.js';

/**
 * The metrics adgate exposes and the only places that write them (S38).
 *
 * Two rules hold everywhere in this file. (1) NO RECORDING MAY AFFECT A REQUEST: every write
 * goes through safely(), so a bug in a metric can never turn a 200 into a 500, and the recorder
 * is handed to routes as an optional collaborator, never as something they must have.
 * (2) CARDINALITY IS BOUNDED BY CONSTRUCTION: every label value is a member of a contract enum
 * (decision, suppress reason, demand source, cache result), an HTTP status, or a route PATTERN
 * from the fixed list below. No app_id, audit_id, conversation or user hash, creative id or raw
 * path ever becomes a label - those are per-tenant identifiers that would multiply the series
 * count by the number of tenants and are already in the audit record and the logs.
 *
 * The classifier cache hit ratio is exposed as three counters rather than a ratio gauge: a
 * gauge would be an average over the process lifetime that no Prometheus query could window,
 * while `rate(adgate_classify_cache_total{result=~"hit.*"}[5m]) / rate(...[5m])` gives the
 * ratio over any window (docs/performance.md).
 */

/** docs/api.md targets: p95 under 300 ms warm, under 700 ms cold; both are bucket edges. */
export const EVALUATE_BUCKETS_SECONDS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 2, 5,
];
/** docs/api.md: one demand adapter gets 250 ms, so the interesting range ends just past it. */
export const ADAPTER_BUCKETS_SECONDS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1,
];

/** The reason label of a serve: the response carries null, and a label must be a string. */
export const NO_REASON = 'none';

/** Route PATTERNS, never raw paths: an id in a label would be unbounded cardinality. */
export const METRICS_PATH = '/metrics';
export const ATTEST_ROUTE = '/v1/attest';
export const OTHER_ROUTE = 'other';

const EXACT_ROUTES: ReadonlySet<string> = new Set([
  '/healthz',
  '/openapi.json',
  METRICS_PATH,
  '/v1/evaluate',
  ATTEST_ROUTE,
  '/v1/events',
]);

const PREFIX_ROUTES: readonly (readonly [prefix: string, pattern: string])[] = [
  ['/v1/audit/', '/v1/audit/:id'],
  ['/v1/verify/', '/v1/verify/:id'],
  ['/c/', '/c/:audit_id'],
];

/** The route pattern a request path belongs to, or `other` for anything unrouted (404s, probes). */
export const routeLabel = (path: string): string => {
  if (EXACT_ROUTES.has(path)) {
    return path;
  }
  for (const [prefix, pattern] of PREFIX_ROUTES) {
    if (path.startsWith(prefix) && path.length > prefix.length) {
      return pattern;
    }
  }
  return OTHER_ROUTE;
};

/** POST /v1/attest outcomes, derived from the status it answered (attest/route.ts). */
export const attestResult = (status: number): string => {
  switch (status) {
    case 204:
      return 'ok';
    case 400:
      return 'invalid_request';
    case 401:
    case 403:
      return 'unauthorized';
    case 404:
      return 'not_found';
    case 409:
      return 'already_attested';
    case 429:
      return 'rate_limited';
    default:
      return 'error';
  }
};

/** How open() found the classification, in the words the metric uses. */
const CACHE_RESULTS: Readonly<Record<CacheSource, string>> = {
  lru: 'hit_memory',
  pg: 'hit_postgres',
  miss: 'miss',
};

/** One finished evaluation, as the route sees it (evaluate/route.ts). */
export interface EvaluationMetrics {
  decision: Decision;
  /** null on a serve. */
  reason: SuppressReason | null;
  /** The whole handler, request in to response out. */
  durationMs: number;
  /** Where the classification came from; absent when classification never ran. */
  cacheSource?: CacheSource | undefined;
  /** The persisted record's demand block, so the histogram matches what was audited. */
  demand?: DemandTrace | undefined;
}

export interface GatewayMetrics {
  registry: MetricsRegistry;
  /** decisions, evaluate latency, per-adapter latency and the cache result of one evaluation. */
  recordEvaluation(input: EvaluationMetrics): void;
  /** One finished HTTP response: the request counter, plus the rate-limit and attest counters. */
  recordHttpRequest(route: string, status: number): void;
}

export interface GatewayMetricsOptions {
  /** The store to register in. Default: a fresh registry (never a module-level global). */
  registry?: MetricsRegistry | undefined;
  /** Milliseconds clock behind the uptime gauge. Defaults to Date.now. */
  now?: Clock | undefined;
}

/** Runs a recording and swallows anything it throws: metrics never reach the request path. */
const safely = (record: () => void): void => {
  try {
    record();
  } catch {
    // A broken metric must not change a response. There is no logger here on purpose: the
    // recorder is called from hot paths and a failing metric would otherwise log per request.
  }
};

export const createGatewayMetrics = (options: GatewayMetricsOptions = {}): GatewayMetrics => {
  const registry = options.registry ?? createMetricsRegistry();
  const now = options.now ?? Date.now;
  const startedAt = now();

  const decisions = registry.counter({
    name: 'adgate_decisions_total',
    help: 'Evaluate decisions by decision and reason (reason "none" on a serve).',
    labelNames: ['decision', 'reason'],
  });
  const evaluateDuration = registry.histogram({
    name: 'adgate_evaluate_duration_seconds',
    help: 'POST /v1/evaluate handler duration in seconds, request in to response out.',
    buckets: EVALUATE_BUCKETS_SECONDS,
  });
  const adapterDuration = registry.histogram({
    name: 'adgate_demand_adapter_duration_seconds',
    help: 'Demand adapter duration in seconds, as recorded in the audit record demand trace.',
    labelNames: ['source'],
    buckets: ADAPTER_BUCKETS_SECONDS,
  });
  const classifyCache = registry.counter({
    name: 'adgate_classify_cache_total',
    help: 'Classifier cache lookups by result: hit_memory, hit_postgres or miss.',
    labelNames: ['result'],
  });
  const httpRequests = registry.counter({
    name: 'adgate_http_requests_total',
    help: 'HTTP responses by route pattern and status code.',
    labelNames: ['route', 'status'],
  });
  const attests = registry.counter({
    name: 'adgate_attest_total',
    help: 'POST /v1/attest outcomes.',
    labelNames: ['result'],
  });
  const rateLimited = registry.counter({
    name: 'adgate_rate_limited_total',
    help: 'Requests refused with 429 by the per-key token bucket.',
  });
  registry.gauge({
    name: 'adgate_process_uptime_seconds',
    help: 'Seconds since this gateway process built its metrics registry.',
    collect: () => (now() - startedAt) / 1000,
  });

  return {
    registry,
    recordEvaluation(input) {
      safely(() => {
        decisions.inc({ decision: input.decision, reason: input.reason ?? NO_REASON });
        evaluateDuration.observe(input.durationMs / 1000);
        if (input.cacheSource !== undefined) {
          classifyCache.inc({ result: CACHE_RESULTS[input.cacheSource] });
        }
        for (const response of input.demand?.responses ?? []) {
          adapterDuration.observe(response.latency_ms / 1000, { source: response.source });
        }
      });
    },
    recordHttpRequest(route, status) {
      safely(() => {
        httpRequests.inc({ route, status: String(status) });
        if (status === 429) {
          rateLimited.inc();
        }
        if (route === ATTEST_ROUTE) {
          attests.inc({ result: attestResult(status) });
        }
      });
    },
  };
};

/**
 * Counts every response, including the ones no route produced (404, 413, 500): app.ts mounts it
 * outermost, and hono resolves a throw at the handler that threw, so this middleware always
 * resumes and sees the final status.
 */
export const httpMetrics = (metrics: GatewayMetrics): MiddlewareHandler<AppEnv> =>
  createMiddleware<AppEnv>(async (c, next) => {
    await next();
    metrics.recordHttpRequest(routeLabel(c.req.path), c.res.status);
  });
