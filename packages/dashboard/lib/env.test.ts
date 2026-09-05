import { describe, expect, it } from 'vitest';

import { DashboardConfigError, loadDashboardEnv, parseTrustedProxyHops } from './env';

const base = {
  DATABASE_URL: 'postgres://adgate:adgate@localhost:5433/adgate',
  ADMIN_PASSWORD: 'local-only',
};

describe('loadDashboardEnv', () => {
  it('derives the session secret from the admin password by default', () => {
    const env = loadDashboardEnv(base);
    expect(env.databaseUrl).toBe(base.DATABASE_URL);
    expect(env.adminPassword).toBe('local-only');
    expect(env.sessionSecret).toContain('local-only');
    expect(env.nodeEnv).toBe('development');
    expect(env.secureCookies).toBe(false);
  });

  it('prefers an explicit DASHBOARD_SESSION_SECRET', () => {
    const env = loadDashboardEnv({ ...base, DASHBOARD_SESSION_SECRET: 'a-separate-secret' });
    expect(env.sessionSecret).toBe('a-separate-secret');
    expect(env.sessionSecret).not.toContain('local-only');
  });

  it('marks cookies secure in production', () => {
    expect(loadDashboardEnv({ ...base, NODE_ENV: 'production' }).secureCookies).toBe(true);
  });

  it('treats blank values as unset', () => {
    expect(() => loadDashboardEnv({ ...base, ADMIN_PASSWORD: '   ' })).toThrow(
      DashboardConfigError,
    );
  });

  it('names every missing variable and no value', () => {
    try {
      loadDashboardEnv({});
      expect.unreachable('expected a DashboardConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(DashboardConfigError);
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('ADMIN_PASSWORD');
      expect(message).not.toContain('local-only');
    }
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadDashboardEnv({ ...base, NODE_ENV: 'staging' })).toThrow(DashboardConfigError);
  });

  it('trusts no proxy hop unless it is told to', () => {
    expect(loadDashboardEnv(base).trustedProxyHops).toBe(0);
    expect(loadDashboardEnv({ ...base, TRUST_PROXY: 'true' }).trustedProxyHops).toBe(1);
    expect(loadDashboardEnv({ ...base, TRUSTED_PROXY_HOPS: '2' }).trustedProxyHops).toBe(2);
  });
});

describe('parseTrustedProxyHops', () => {
  it('reads the boolean form as exactly one hop', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(parseTrustedProxyHops(value, undefined), value).toBe(1);
    }
    for (const value of ['0', 'false', 'no', '', '   ']) {
      expect(parseTrustedProxyHops(value, undefined), value).toBe(0);
    }
  });

  it('lets the hop count win over the boolean', () => {
    expect(parseTrustedProxyHops('true', '3')).toBe(3);
    expect(parseTrustedProxyHops('true', '0')).toBe(0);
  });

  it('trusts nothing when the value makes no sense', () => {
    for (const value of ['two', '-1', '1.5', 'NaN']) {
      expect(parseTrustedProxyHops('true', value), value).toBe(0);
    }
  });
});
