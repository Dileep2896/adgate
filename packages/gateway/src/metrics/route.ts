import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';

import type { AppEnv } from '../app-env.js';
import { errorResponse } from '../http-error.js';
import { CACHE_CONTROL_HEADER, NO_STORE } from '../security.js';
import { EXPOSITION_CONTENT_TYPE } from './exposition.js';
import type { MetricsRegistry } from './registry.js';

/**
 * GET /metrics: the Prometheus scrape endpoint (S38).
 *
 * It is NOT behind bearerAuth. An API key belongs to one app and this body is about the whole
 * process, so the endpoint has an operator secret of its own, METRICS_TOKEN, presented as a
 * bearer and compared in constant time. When METRICS_TOKEN is unset app.ts does not mount the
 * route at all, so the endpoint answers the ordinary 404: a deployment that forgot to set the
 * token exposes nothing, and "disabled" is indistinguishable from "this build has no such
 * route" to anyone scanning.
 *
 * The body is a snapshot of counters that includes no per-tenant identifier (instrument.ts
 * bounds every label), but it still says how much traffic an operator handles, so the response
 * carries Cache-Control: no-store; the security headers come from app.ts like everywhere else.
 */
export const METRICS_UNAUTHORIZED_MESSAGE = 'missing or invalid metrics token';
export const METRICS_WWW_AUTHENTICATE = 'Bearer realm="adgate-metrics"';

const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i;

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time comparison of the presented token with the configured one. Both sides are
 * hashed first, so the buffers are always 32 bytes (timingSafeEqual throws on a length
 * mismatch) and the comparison leaks neither the token's length nor its contents.
 */
export const tokenMatches = (presented: string | undefined, expected: string): boolean =>
  presented !== undefined && timingSafeEqual(digest(presented), digest(expected));

/** The token of an `Authorization: Bearer <token>` header, or undefined. */
export const bearerToken = (header: string | undefined): string | undefined =>
  header === undefined ? undefined : (BEARER_PATTERN.exec(header)?.[1] ?? undefined);

export interface MetricsRouteDeps {
  registry: MetricsRegistry;
  /** METRICS_TOKEN. app.ts only mounts the route when it is set. */
  token: string;
}

export const metricsRoute =
  (deps: MetricsRouteDeps) =>
  (c: Context<AppEnv>): Response => {
    const log = c.get('logger');
    if (!tokenMatches(bearerToken(c.req.header('authorization')), deps.token)) {
      log.debug({ status: 401 }, 'metrics scrape rejected');
      const response = errorResponse(c, 401, 'unauthorized', METRICS_UNAUTHORIZED_MESSAGE);
      response.headers.set('WWW-Authenticate', METRICS_WWW_AUTHENTICATE);
      response.headers.set(CACHE_CONTROL_HEADER, NO_STORE);
      return response;
    }
    let body: string;
    try {
      body = deps.registry.render();
    } catch (error) {
      // Rendering is arithmetic over in-memory counters; if it ever fails, say so plainly
      // rather than letting the scrape 500 with an unhandled error.
      log.error({ err: error }, 'metrics render failed');
      return errorResponse(c, 500, 'internal_error', 'Internal error');
    }
    return c.body(body, 200, {
      'Content-Type': EXPOSITION_CONTENT_TYPE,
      [CACHE_CONTROL_HEADER]: NO_STORE,
    });
  };
