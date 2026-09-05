import type { Context, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import type { AppEnv } from './app-env.js';
import { REMAINING_HEADER, RETRY_AFTER_HEADER } from './rate-limit/middleware.js';
import { REQUEST_ID_HEADER } from './request-id.js';

/**
 * The two response-hardening middlewares app.ts mounts on every route (S36).
 *
 * securityHeaders() writes the helmet-style headers on the way out, so they are on every
 * response including 404s, 413s and the 500 body: nosniff, no-referrer, DENY plus a
 * frame-ancestors CSP, and Cross-Origin-Resource-Policy: same-origin. HSTS is set only when
 * the request actually arrived over TLS (directly or through a proxy that says so), so a
 * developer on http://localhost never pins their browser to https. A response produced behind
 * bearerAuth is per-tenant, so it also gets Cache-Control: no-store unless the route already
 * set its own (the click redirect sets no-store itself).
 *
 * corsPolicy() enforces CORS_ALLOWED_ORIGINS: an Origin that is not on the list gets no CORS
 * headers at all and its preflight is refused with 403, so a browser page on another origin
 * cannot read a response. A wildcard exists only when the list holds the literal `*` entry;
 * credentials are never enabled (the API is authenticated with a bearer header, never cookies),
 * which is also why a wildcard can never be paired with Access-Control-Allow-Credentials.
 */

/** Set on every response. Values are constants: nothing here reflects request input. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  // A JSON API loads nothing and belongs in no frame.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export const HSTS_HEADER = 'Strict-Transport-Security';
/** One year, subdomains included. Never sent on plain http (dev). */
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';
export const CACHE_CONTROL_HEADER = 'Cache-Control';
export const NO_STORE = 'no-store';

/** True when the request reached the gateway over TLS, directly or via a terminating proxy. */
export const isHttpsRequest = (c: Context<AppEnv>): boolean => {
  const forwarded = c.req.header('x-forwarded-proto');
  if (forwarded !== undefined) {
    return forwarded.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  return c.req.url.startsWith('https:');
};

export const securityHeaders = (): MiddlewareHandler<AppEnv> =>
  createMiddleware<AppEnv>(async (c, next) => {
    await next();
    const { headers } = c.res;
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers.set(name, value);
    }
    if (isHttpsRequest(c)) {
      headers.set(HSTS_HEADER, HSTS_VALUE);
    }
    // Authenticated responses carry one tenant's data; no shared cache may keep them.
    if (c.get('auth') !== undefined && !headers.has(CACHE_CONTROL_HEADER)) {
      headers.set(CACHE_CONTROL_HEADER, NO_STORE);
    }
  });

/** The only entry that turns CORS into a wildcard, and only when written out in the env var. */
export const WILDCARD_ORIGIN = '*';
export const CORS_FORBIDDEN_MESSAGE = 'origin not allowed by CORS_ALLOWED_ORIGINS';

/** Trimmed, de-duplicated, blanks dropped. An empty result allows no browser origin at all. */
export const normalizeOrigins = (origins: readonly string[]): readonly string[] => [
  ...new Set(origins.map((origin) => origin.trim()).filter((origin) => origin !== '')),
];

export interface CorsDecision {
  /** The list after normalization. */
  allowed: readonly string[];
  /** True when the list holds the literal `*`. */
  wildcard: boolean;
  isAllowed: (origin: string | undefined) => boolean;
}

export const corsDecision = (origins: readonly string[]): CorsDecision => {
  const allowed = normalizeOrigins(origins);
  const wildcard = allowed.includes(WILDCARD_ORIGIN);
  return {
    allowed,
    wildcard,
    isAllowed: (origin) =>
      origin !== undefined && origin !== '' && (wildcard || allowed.includes(origin)),
  };
};

/**
 * Removes every Access-Control-* header. hono's cors writes Expose-Headers whatever the origin
 * is; a request whose origin is not on the list must carry no CORS header at all.
 */
const stripCorsHeaders = (headers: Headers): void => {
  const names: string[] = [];
  headers.forEach((_value, name) => {
    if (name.toLowerCase().startsWith('access-control-')) {
      names.push(name);
    }
  });
  for (const name of names) {
    headers.delete(name);
  }
};

export const corsPolicy = (origins: readonly string[]): MiddlewareHandler<AppEnv> => {
  const decision = corsDecision(origins);
  const inner: MiddlewareHandler = cors({
    origin: decision.wildcard
      ? WILDCARD_ORIGIN
      : (origin) => (decision.isAllowed(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type', REQUEST_ID_HEADER],
    exposeHeaders: [REQUEST_ID_HEADER, RETRY_AFTER_HEADER, REMAINING_HEADER],
    maxAge: 600,
    // credentials stays off on purpose: bearer tokens, never cookies, and a wildcard origin
    // with credentials would be both refused by browsers and a genuine hole.
  });
  return createMiddleware<AppEnv>(async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = decision.isAllowed(origin);
    if (c.req.method === 'OPTIONS' && origin !== undefined && !allowed) {
      // A preflight is the browser asking permission; say no rather than answer 204 with
      // nothing on it.
      throw new HTTPException(403, { message: CORS_FORBIDDEN_MESSAGE });
    }
    const response = await inner(c, next);
    if (!allowed) {
      stripCorsHeaders(response instanceof Response ? response.headers : c.res.headers);
    }
    return response;
  });
};
