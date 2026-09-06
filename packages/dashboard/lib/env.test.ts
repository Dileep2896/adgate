import { describe, expect, it } from 'vitest';

import {
  adminPasswordIssues,
  bootAdminPasswordIssues,
  DashboardConfigError,
  loadDashboardEnv,
  MIN_PRODUCTION_ADMIN_PASSWORD,
  parseTrustedProxyHops,
  PLACEHOLDER_ADMIN_PASSWORD,
} from './env';

const base = {
  DATABASE_URL: 'postgres://adgate:adgate@localhost:5433/adgate',
  ADMIN_PASSWORD: 'local-only',
};

/** A production password long enough for the boot rule; the value itself means nothing. */
const STRONG_PASSWORD = 'DEsB0Yc6xUZHpAOKvA1nq2Iu';

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
    // Production also insists on a real password, so this cannot use the dev one.
    const env = loadDashboardEnv({
      ...base,
      NODE_ENV: 'production',
      ADMIN_PASSWORD: STRONG_PASSWORD,
    });
    expect(env.secureCookies).toBe(true);
  });

  it('refuses to load a production environment with a weak or placeholder password', () => {
    for (const password of ['local-only', PLACEHOLDER_ADMIN_PASSWORD, 'x'.repeat(15)]) {
      const attempt = () =>
        loadDashboardEnv({ ...base, NODE_ENV: 'production', ADMIN_PASSWORD: password });
      expect(attempt, password).toThrow(DashboardConfigError);
      expect(attempt, password).toThrow(/ADMIN_PASSWORD/);
    }
    // Exactly at the boundary is fine.
    expect(
      loadDashboardEnv({ ...base, NODE_ENV: 'production', ADMIN_PASSWORD: 'y'.repeat(16) })
        .adminPassword,
    ).toHaveLength(MIN_PRODUCTION_ADMIN_PASSWORD);
  });

  it('leaves development and test alone', () => {
    for (const nodeEnv of ['development', 'test']) {
      expect(
        loadDashboardEnv({ ...base, NODE_ENV: nodeEnv, ADMIN_PASSWORD: PLACEHOLDER_ADMIN_PASSWORD })
          .adminPassword,
        nodeEnv,
      ).toBe(PLACEHOLDER_ADMIN_PASSWORD);
    }
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

/**
 * The boot check instrumentation.ts runs. `next build` runs with NODE_ENV=production and no
 * password at all, so an UNSET password must stay a first-request error and never a failed
 * build - that is the case worth pinning here.
 */
describe('bootAdminPasswordIssues', () => {
  it('stops a production boot on a weak or placeholder password', () => {
    for (const password of [PLACEHOLDER_ADMIN_PASSWORD, 'short', 'x'.repeat(15)]) {
      expect(
        bootAdminPasswordIssues({ NODE_ENV: 'production', ADMIN_PASSWORD: password }),
        password,
      ).toHaveLength(1);
    }
  });

  it('says nothing about a password that is not set, so `next build` still builds', () => {
    for (const env of [{}, { ADMIN_PASSWORD: '' }, { ADMIN_PASSWORD: '   ' }]) {
      expect(bootAdminPasswordIssues({ NODE_ENV: 'production', ...env })).toEqual([]);
    }
  });

  it('allows a strong password, and every password outside production', () => {
    expect(
      bootAdminPasswordIssues({ NODE_ENV: 'production', ADMIN_PASSWORD: STRONG_PASSWORD }),
    ).toEqual([]);
    expect(
      bootAdminPasswordIssues({
        NODE_ENV: 'development',
        ADMIN_PASSWORD: PLACEHOLDER_ADMIN_PASSWORD,
      }),
    ).toEqual([]);
    // No NODE_ENV at all is development, not production.
    expect(bootAdminPasswordIssues({ ADMIN_PASSWORD: 'short' })).toEqual([]);
  });

  it('never puts the password in the message', () => {
    const secret = 'hunter2!';
    const [issue] = bootAdminPasswordIssues({ NODE_ENV: 'production', ADMIN_PASSWORD: secret });
    expect(issue).toBeDefined();
    expect(issue).not.toContain(secret);
    expect(issue).toContain('at least 16 characters');
  });

  it('names the placeholder rather than the length when the password is the example one', () => {
    expect(adminPasswordIssues(PLACEHOLDER_ADMIN_PASSWORD, 'production').join('\n')).toContain(
      'placeholder',
    );
    expect(adminPasswordIssues(STRONG_PASSWORD, 'production')).toEqual([]);
    expect(adminPasswordIssues(PLACEHOLDER_ADMIN_PASSWORD, 'development')).toEqual([]);
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
