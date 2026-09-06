import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_COOKIE_NAME } from './lib/session';

/**
 * The middleware reads DASHBOARD_ALLOWED_IPS and TRUST_PROXY at MODULE SCOPE, because Next
 * inlines them into the Edge bundle at build time. So does this test: each case stubs the
 * environment, resets the module registry and imports a fresh copy - which also mirrors the
 * deployment truth that changing either variable needs a redeploy, not a restart.
 */

const BASE = 'https://dashboard.example';

interface LoadOptions {
  allowedIps?: string;
  trustProxy?: string;
  trustedProxyHops?: string;
}

const loadMiddleware = async (options: LoadOptions = {}) => {
  vi.resetModules();
  vi.stubEnv('DASHBOARD_ALLOWED_IPS', options.allowedIps ?? '');
  vi.stubEnv('TRUST_PROXY', options.trustProxy ?? '');
  vi.stubEnv('TRUSTED_PROXY_HOPS', options.trustedProxyHops ?? '');
  const loaded = await import('./middleware');
  return loaded.middleware;
};

const request = (
  path: string,
  headers: Record<string, string> = {},
  cookie?: string,
): NextRequest => {
  const all = cookie === undefined ? headers : { ...headers, cookie: `${SESSION_COOKIE_NAME}=x` };
  return new NextRequest(new URL(path, BASE), { headers: all });
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('middleware without DASHBOARD_ALLOWED_IPS', () => {
  it('behaves exactly as before: login is public, everything else needs a cookie', async () => {
    const middleware = await loadMiddleware();
    for (const path of ['/login', '/api/login', '/api/logout']) {
      expect(middleware(request(path)).status, path).toBe(200);
    }
    const redirect = middleware(request('/apps?page=2'));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get('location')).toContain('/login?from=%2Fapps%3Fpage%3D2');
    expect(middleware(request('/apps', {}, 'session')).status).toBe(200);
  });

  it('ignores x-forwarded-for entirely when there is no allowlist', async () => {
    const middleware = await loadMiddleware();
    expect(middleware(request('/login', { 'x-forwarded-for': '198.51.100.9' })).status).toBe(200);
  });
});

describe('middleware with DASHBOARD_ALLOWED_IPS', () => {
  it('refuses an address outside the list with 403, before /login is reachable', async () => {
    const middleware = await loadMiddleware({
      allowedIps: '203.0.113.7, 198.51.100.0/24',
      trustProxy: 'true',
    });
    for (const path of ['/login', '/api/login', '/apps', '/']) {
      const response = middleware(request(path, { 'x-forwarded-for': '192.0.2.5' }));
      expect(response.status, path).toBe(403);
      expect(response.headers.get('cache-control'), path).toBe('no-store');
    }
    expect(await middleware(request('/login', { 'x-forwarded-for': '192.0.2.5' })).text()).toBe(
      'Forbidden',
    );
  });

  it('lets a listed address through to the ordinary session check', async () => {
    const middleware = await loadMiddleware({
      allowedIps: '203.0.113.7, 198.51.100.0/24',
      trustProxy: 'true',
    });
    expect(middleware(request('/login', { 'x-forwarded-for': '203.0.113.7' })).status).toBe(200);
    expect(middleware(request('/login', { 'x-forwarded-for': '198.51.100.42' })).status).toBe(200);
    // Still no free pass to a protected page: the cookie check runs after the allowlist.
    expect(middleware(request('/apps', { 'x-forwarded-for': '203.0.113.7' })).status).toBe(307);
    expect(
      middleware(request('/apps', { 'x-forwarded-for': '203.0.113.7' }, 'session')).status,
    ).toBe(200);
  });

  it('reads the client the way TRUST_PROXY says, not the first hop the client wrote', async () => {
    const middleware = await loadMiddleware({
      allowedIps: '203.0.113.7',
      trustProxy: 'true',
    });
    // One trusted proxy: the client is the LAST entry, so a spoofed leading entry is skipped.
    expect(
      middleware(request('/login', { 'x-forwarded-for': '203.0.113.7, 192.0.2.5' })).status,
    ).toBe(403);
    expect(
      middleware(request('/login', { 'x-forwarded-for': '192.0.2.5, 203.0.113.7' })).status,
    ).toBe(200);
  });

  it('refuses everything when the allowlist is set and TRUST_PROXY is not', async () => {
    // The documented Vercel footgun: with no trusted hop clientKey() answers 'unknown', which
    // is on no allowlist. Refusing is the safe half of the mistake.
    const middleware = await loadMiddleware({ allowedIps: '203.0.113.7' });
    expect(middleware(request('/login', { 'x-forwarded-for': '203.0.113.7' })).status).toBe(403);
  });

  it('refuses everything when every entry in the list is a typo', async () => {
    const middleware = await loadMiddleware({ allowedIps: 'not-an-ip', trustProxy: 'true' });
    expect(middleware(request('/login', { 'x-forwarded-for': '203.0.113.7' })).status).toBe(403);
  });
});
