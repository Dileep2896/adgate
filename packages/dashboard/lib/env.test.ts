import { describe, expect, it } from 'vitest';

import { DashboardConfigError, loadDashboardEnv } from './env';

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
});
