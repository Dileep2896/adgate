import { ErrorResponse } from '@adgateio/schemas';
import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { BODY_LIMIT_BYTES, createApp } from './app.js';
import type { AppEnv } from './app-env.js';
import { createLogger } from './logger.js';
import {
  CACHE_CONTROL_HEADER,
  CORS_FORBIDDEN_MESSAGE,
  HSTS_HEADER,
  HSTS_VALUE,
  isHttpsRequest,
  NO_STORE,
  normalizeOrigins,
  SECURITY_HEADERS,
  WILDCARD_ORIGIN,
} from './security.js';
import { collectLogs } from './test-support/logs.js';

/**
 * S36: the response headers on every route, the CORS allowlist, and the body limit on the
 * three documented POST endpoints. No database: createApp without evaluate deps still mounts
 * every middleware, and the body limit runs before routing, so an oversized POST to
 * /v1/evaluate is 413 rather than 404. security.integration.test.ts repeats the checks
 * against the wired routes.
 */
const build = (corsAllowedOrigins: string[] = []) => {
  const { lines, stream } = collectLogs();
  const app = createApp({
    logger: createLogger({ level: 'silent' }, stream),
    corsAllowedOrigins,
  });
  app.get('/authed', (c) => {
    c.set('auth', { key_id: 'key_1', app_id: 'app_1', role: 'app', advertiser_id: null });
    return c.json({ ok: true });
  });
  app.get('/cached', (c) => {
    c.set('auth', { key_id: 'key_1', app_id: 'app_1', role: 'app', advertiser_id: null });
    c.header(CACHE_CONTROL_HEADER, 'public, max-age=60');
    return c.json({ ok: true });
  });
  app.get('/boom', () => {
    throw new Error('boom');
  });
  return { app, lines };
};

const POST_PATHS = ['/v1/evaluate', '/v1/attest', '/v1/events'] as const;

const expectSecurityHeaders = (res: Response): void => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(res.headers.get(name), `${name} on ${res.status}`).toBe(value);
  }
};

describe('security headers', () => {
  it('are on /healthz, on the 404 body and on the 500 body', async () => {
    const { app } = build();
    for (const path of ['/healthz', '/nope', '/boom']) {
      const res = await app.request(path);
      expectSecurityHeaders(res);
    }
    expect((await app.request('/nope')).status).toBe(404);
    expect((await app.request('/boom')).status).toBe(500);
  });

  it('name nosniff, no-referrer, DENY, a frame-ancestors CSP and same-origin CORP', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(SECURITY_HEADERS['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('set HSTS only when the request arrived over TLS', async () => {
    const { app } = build();
    const plain = await app.request('/healthz');
    expect(plain.headers.get(HSTS_HEADER)).toBeNull();

    const proxied = await app.request('/healthz', { headers: { 'x-forwarded-proto': 'https' } });
    expect(proxied.headers.get(HSTS_HEADER)).toBe(HSTS_VALUE);

    const proxiedPlain = await app.request('/healthz', {
      headers: { 'x-forwarded-proto': 'http' },
    });
    expect(proxiedPlain.headers.get(HSTS_HEADER)).toBeNull();

    const tls = await app.request('https://gateway.test/healthz');
    expect(tls.headers.get(HSTS_HEADER)).toBe(HSTS_VALUE);
  });

  it('read the first entry of a chained x-forwarded-proto', () => {
    const of = (header: string | undefined, url = 'http://gateway.test/healthz') =>
      isHttpsRequest({
        req: { header: () => header, url },
      } as unknown as Context<AppEnv>);
    expect(of('https, http')).toBe(true);
    expect(of('http, https')).toBe(false);
    expect(of('HTTPS')).toBe(true);
    expect(of(undefined)).toBe(false);
    expect(of(undefined, 'https://gateway.test/healthz')).toBe(true);
  });

  it('add Cache-Control: no-store to an authenticated response, keeping a route’s own value', async () => {
    const { app } = build();
    expect((await app.request('/authed')).headers.get(CACHE_CONTROL_HEADER)).toBe(NO_STORE);
    expect((await app.request('/cached')).headers.get(CACHE_CONTROL_HEADER)).toBe(
      'public, max-age=60',
    );
    // Public routes are not touched: /healthz and /openapi.json stay cacheable.
    expect((await app.request('/healthz')).headers.get(CACHE_CONTROL_HEADER)).toBeNull();
  });
});

describe('CORS allowlist', () => {
  it('answers an allowed origin with exactly that origin and Vary: Origin', async () => {
    const { app } = build(['http://localhost:3000', 'https://app.example.com']);
    for (const origin of ['http://localhost:3000', 'https://app.example.com']) {
      const res = await app.request('/healthz', { headers: { origin } });
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('vary')).toContain('Origin');
    }
  });

  it('blocks an origin that is not on the list: no CORS headers, and 403 on the preflight', async () => {
    const { app } = build(['http://localhost:3000']);
    const blocked = await app.request('/healthz', { headers: { origin: 'https://evil.example' } });
    expect(blocked.status).toBe(200);
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
    expect(blocked.headers.get('access-control-expose-headers')).toBeNull();

    const preflight = await app.request('/v1/evaluate', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.headers.get('access-control-allow-methods')).toBeNull();
    const body = ErrorResponse.parse(await preflight.json());
    expect(body.error).toEqual({ code: 'forbidden', message: CORS_FORBIDDEN_MESSAGE });
  });

  it('lets an allowed preflight through with the documented methods and headers', async () => {
    const { app } = build(['http://localhost:3000']);
    const preflight = await app.request('/v1/evaluate', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(preflight.headers.get('access-control-max-age')).toBe('600');
  });

  it('allows no browser origin when the list is empty', async () => {
    const { app } = build([]);
    const res = await app.request('/healthz', { headers: { origin: 'http://localhost:3000' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await app.request('/healthz', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
    });
    expect(preflight.status).toBe(403);
  });

  it('is a wildcard only for the explicit * entry', async () => {
    const { app } = build([WILDCARD_ORIGIN]);
    const res = await app.request('/healthz', { headers: { origin: 'https://anything.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const preflight = await app.request('/healthz', {
      method: 'OPTIONS',
      headers: { origin: 'https://anything.example', 'access-control-request-method': 'GET' },
    });
    expect(preflight.status).toBe(204);

    // A literal origin never turns into one: an allowlist of one host allows only that host.
    const { app: strict } = build(['https://app.example.com']);
    const other = await strict.request('/healthz', {
      headers: { origin: 'https://app.example.com.evil.test' },
    });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('never enables credentials, so a wildcard can never be paired with them', async () => {
    for (const origins of [[WILDCARD_ORIGIN], ['https://app.example.com'], []]) {
      const { app } = build(origins);
      for (const origin of ['https://app.example.com', 'https://evil.example']) {
        const res = await app.request('/healthz', { headers: { origin } });
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
      }
    }
  });

  it('trims, de-duplicates and drops blank entries from the env list', () => {
    expect(normalizeOrigins([' http://a ', 'http://a', '', '  ', 'http://b'])).toEqual([
      'http://a',
      'http://b',
    ]);
  });
});

describe('body limit', () => {
  it('answers a POST over the limit with 413 on every documented endpoint', async () => {
    const { app } = build();
    const handler = vi.fn((c: Context<AppEnv>) => c.json({ ok: true }));
    for (const path of POST_PATHS) {
      app.post(path, handler);
    }
    const oversized = JSON.stringify({ pad: 'x'.repeat(BODY_LIMIT_BYTES) });
    for (const path of POST_PATHS) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: oversized,
      });
      expect(res.status, path).toBe(413);
      const body = ErrorResponse.parse(await res.json());
      expect(body.error.code).toBe('payload_too_large');
      expect(body.error.message).toContain(String(BODY_LIMIT_BYTES));
      expectSecurityHeaders(res);
    }
    expect(handler).not.toHaveBeenCalled();
  });
});
