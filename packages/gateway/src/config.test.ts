import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  configWarnings,
  EXAMPLE_VALUES,
  type GatewayConfig,
  loadConfig,
  productionIssues,
} from './config.js';

const PRIVATE_PEM =
  '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----\n';

const MINIMAL = {
  DATABASE_URL: 'postgres://adgate:adgate@localhost:5432/adgate',
  ADGATE_SIGNING_KEY_ID: 'k_test',
  ADGATE_SIGNING_KEY_PEM: PRIVATE_PEM,
};

/** MINIMAL plus everything a production boot additionally insists on. */
const PRODUCTION = {
  ...MINIMAL,
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://ads.example.com',
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const failure = (env: Record<string, string | undefined>): ConfigError => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('loadConfig did not throw');
};

describe('loadConfig', () => {
  it('fails fast with a readable error naming a missing DATABASE_URL', () => {
    const error = failure({ ...MINIMAL, DATABASE_URL: undefined });
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('missing');
    expect(error.issues).toHaveLength(1);
  });

  it('treats a blank value as missing', () => {
    const error = failure({ ...MINIMAL, DATABASE_URL: '   ' });
    expect(error.message).toContain('DATABASE_URL');
  });

  it('tells the user to run keygen when the signing key PEM is empty', () => {
    for (const value of ['', undefined]) {
      const error = failure({ ...MINIMAL, ADGATE_SIGNING_KEY_PEM: value });
      expect(error.message).toContain('ADGATE_SIGNING_KEY_PEM');
      expect(error.message).toContain('pnpm --filter @adgateio/gateway keygen');
    }
  });

  it('lists every problem at once', () => {
    const error = failure({ ADGATE_SIGNING_KEY_PEM: PRIVATE_PEM });
    expect(error.issues).toHaveLength(2);
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('ADGATE_SIGNING_KEY_ID');
    expect(error.message.split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('defaults the database timeouts and accepts 0 to disable one', () => {
    expect(loadConfig(MINIMAL).db).toEqual({ statementTimeoutMs: 2000, lockTimeoutMs: 1000 });
    expect(
      loadConfig({ ...MINIMAL, DB_STATEMENT_TIMEOUT_MS: '0', DB_LOCK_TIMEOUT_MS: '250' }).db,
    ).toEqual({ statementTimeoutMs: 0, lockTimeoutMs: 250 });
    expect(failure({ ...MINIMAL, DB_LOCK_TIMEOUT_MS: '-1' }).message).toContain(
      'DB_LOCK_TIMEOUT_MS',
    );
  });

  it('names an invalid PORT', () => {
    expect(failure({ ...MINIMAL, PORT: 'abc' }).message).toContain('PORT');
    expect(failure({ ...MINIMAL, PORT: '70000' }).message).toContain('PORT');
  });

  it('names an invalid key id, log level and boolean', () => {
    expect(failure({ ...MINIMAL, ADGATE_SIGNING_KEY_ID: 'bad id' }).message).toContain(
      'ADGATE_SIGNING_KEY_ID',
    );
    expect(failure({ ...MINIMAL, LOG_LEVEL: 'loud' }).message).toContain('LOG_LEVEL');
    expect(failure({ ...MINIMAL, KOAH_ENABLED: 'maybe' }).message).toContain('KOAH_ENABLED');
  });

  it('never falls back to process.env', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('applies the documented defaults', () => {
    const config = loadConfig(MINIMAL);
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(8787);
    expect(config.logLevel).toBe('info');
    expect(config.databaseUrl).toBe(MINIMAL.DATABASE_URL);
    expect(config.databaseUrlTest).toBeNull();
    expect(config.corsAllowedOrigins).toEqual([]);
    expect(config.publicBaseUrl).toBe('http://localhost:8787');
    expect(config.metricsToken).toBeNull();
    expect(config.adminPassword).toBeNull();
    expect(config.signing).toEqual({
      keyId: 'k_test',
      privatePem: PRIVATE_PEM,
      publicKeysJson: '{}',
    });
    expect(config.classifier).toBeNull();
    expect(config.classifierTimeoutMs).toBe(400);
    expect(config.koah).toEqual({ enabled: false });
    expect(config.gravity).toEqual({ enabled: false });
    expect(config.rateLimit).toEqual({ rps: 20, burst: 40 });
    expect(config.retentionIntervalHours).toBe(0);
  });

  it('reads the retention interval and rejects a negative or fractional one', () => {
    expect(loadConfig({ ...MINIMAL, RETENTION_INTERVAL_HOURS: '24' }).retentionIntervalHours).toBe(
      24,
    );
    expect(failure({ ...MINIMAL, RETENTION_INTERVAL_HOURS: '-1' }).message).toContain(
      'RETENTION_INTERVAL_HOURS',
    );
    expect(failure({ ...MINIMAL, RETENTION_INTERVAL_HOURS: '1.5' }).message).toContain(
      'RETENTION_INTERVAL_HOURS',
    );
  });

  it('reads the rate limit and rejects a zero rate or a fractional burst', () => {
    expect(
      loadConfig({ ...MINIMAL, RATE_LIMIT_RPS: '0.5', RATE_LIMIT_BURST: '3' }).rateLimit,
    ).toEqual({
      rps: 0.5,
      burst: 3,
    });
    expect(failure({ ...MINIMAL, RATE_LIMIT_RPS: '0' }).message).toContain('RATE_LIMIT_RPS');
    expect(failure({ ...MINIMAL, RATE_LIMIT_BURST: '2.5' }).message).toContain('RATE_LIMIT_BURST');
    expect(failure({ ...MINIMAL, RATE_LIMIT_BURST: '0' }).message).toContain('RATE_LIMIT_BURST');
  });

  it('parses a fully populated environment', () => {
    const config = loadConfig({
      ...MINIMAL,
      NODE_ENV: 'production',
      PORT: '9000',
      LOG_LEVEL: 'debug',
      DATABASE_URL_TEST: 'postgres://adgate:adgate@localhost:5432/adgate_test',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000, https://app.example.com ,',
      PUBLIC_BASE_URL: 'https://ads.example.com',
      METRICS_TOKEN: 'metrics-secret',
      ADMIN_PASSWORD: 'admin-secret',
      ADGATE_PUBLIC_KEYS_JSON:
        '{"k_old":"-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----\\n"}',
      CLASSIFIER_BASE_URL: 'https://api.openai.com/v1',
      CLASSIFIER_API_KEY: 'sk-test',
      CLASSIFIER_MODEL: 'gpt-4o-mini',
      CLASSIFIER_TIMEOUT_MS: '250',
      KOAH_ENABLED: 'true',
      KOAH_API_KEY: 'koah-secret',
      KOAH_BASE_URL: 'https://api.koah.example',
      GRAVITY_ENABLED: '0',
      GRAVITY_API_KEY: 'gravity-secret',
    });
    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(9000);
    expect(config.logLevel).toBe('debug');
    expect(config.databaseUrlTest).toBe('postgres://adgate:adgate@localhost:5432/adgate_test');
    expect(config.corsAllowedOrigins).toEqual(['http://localhost:3000', 'https://app.example.com']);
    expect(config.publicBaseUrl).toBe('https://ads.example.com');
    expect(config.metricsToken).toBe('metrics-secret');
    expect(config.adminPassword).toBe('admin-secret');
    expect(config.signing.publicKeysJson).toContain('k_old');
    expect(config.classifier).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      timeoutMs: 250,
    });
    expect(config.classifierTimeoutMs).toBe(250);
    expect(config.koah).toEqual({
      enabled: true,
      api_key: 'koah-secret',
      base_url: 'https://api.koah.example',
    });
    expect(config.gravity).toEqual({ enabled: false, api_key: 'gravity-secret' });
  });

  it('runs rules only when the classifier model or base URL is not set', () => {
    expect(
      loadConfig({ ...MINIMAL, CLASSIFIER_BASE_URL: 'https://api.openai.com/v1' }).classifier,
    ).toBeNull();
    expect(loadConfig({ ...MINIMAL, CLASSIFIER_MODEL: 'gpt-4o-mini' }).classifier).toBeNull();
    const config = loadConfig({
      ...MINIMAL,
      CLASSIFIER_BASE_URL: 'http://localhost:11434/v1',
      CLASSIFIER_MODEL: 'llama',
    });
    // No API key is fine for a local endpoint: the client then sends no Authorization header.
    expect(config.classifier).toEqual({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'llama',
      timeoutMs: 400,
    });
  });

  it('restores PEM line breaks written as \\n escapes', () => {
    const flattened = PRIVATE_PEM.replace(/\n/g, '\\n');
    expect(loadConfig({ ...MINIMAL, ADGATE_SIGNING_KEY_PEM: flattened }).signing.privatePem).toBe(
      PRIVATE_PEM,
    );
  });

  it('does not mutate the environment it reads', () => {
    const env = { ...MINIMAL, PORT: '9000' };
    const snapshot = { ...env };
    loadConfig(env);
    expect(env).toEqual(snapshot);
  });

  it('ignores unrelated variables', () => {
    expect(() => loadConfig({ ...MINIMAL, PATH: '/usr/bin', HOME: '/home' })).not.toThrow();
  });
});

/**
 * The production-only checks. Each one is a value that is perfectly fine on a laptop and fails
 * SILENTLY once deployed - a click URL pointing at the container, an admin password that is the
 * word in the example file - so the boot refuses instead of serving something broken. Every test
 * here has a development twin below proving the same value still starts a dev server.
 */
describe('loadConfig in production', () => {
  it('accepts a properly configured production environment', () => {
    const config = loadConfig({
      ...PRODUCTION,
      ADMIN_PASSWORD: 'a-long-random-admin-password',
      METRICS_TOKEN: 'a-random-metrics-token',
    });
    expect(config.nodeEnv).toBe('production');
    expect(config.publicBaseUrl).toBe('https://ads.example.com');
  });

  it('refuses a PUBLIC_BASE_URL pointing at this machine', () => {
    for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '[::1]']) {
      const error = failure({ ...PRODUCTION, PUBLIC_BASE_URL: `https://${host}:8787` });
      expect(error.message, host).toContain('PUBLIC_BASE_URL');
      expect(error.message, host).toContain('this machine');
    }
  });

  it('refuses the default PUBLIC_BASE_URL, which is the local one', () => {
    // Nothing sets it: the schema default (http://localhost:8787) is what production sees.
    const error = failure({ ...PRODUCTION, PUBLIC_BASE_URL: undefined });
    expect(error.message).toContain('PUBLIC_BASE_URL');
    expect(error.message).toContain('this machine');
  });

  it('refuses a PUBLIC_BASE_URL that is not https', () => {
    const error = failure({ ...PRODUCTION, PUBLIC_BASE_URL: 'http://ads.example.com' });
    expect(error.issues).toHaveLength(1);
    expect(error.message).toContain('must be https in production');
  });

  it('refuses the .env.example ADMIN_PASSWORD', () => {
    const error = failure({ ...PRODUCTION, ADMIN_PASSWORD: EXAMPLE_VALUES['ADMIN_PASSWORD'] });
    expect(error.message).toContain('ADMIN_PASSWORD');
    expect(error.message).toContain('placeholder');
  });

  it('refuses the .env.example METRICS_TOKEN', () => {
    const error = failure({ ...PRODUCTION, METRICS_TOKEN: EXAMPLE_VALUES['METRICS_TOKEN'] });
    expect(error.message).toContain('METRICS_TOKEN');
    expect(error.message).toContain('placeholder');
  });

  it('refuses the .env.example ADGATE_SIGNING_KEY_PEM', () => {
    // The example file ships it EMPTY, which the required-variable check already rejects, so the
    // comparison is exercised directly here: it is what keeps working if the example ever gains
    // a real placeholder key.
    const config = loadConfig(PRODUCTION);
    const issues = productionIssues({
      ...config,
      signing: { ...config.signing, privatePem: EXAMPLE_VALUES['ADGATE_SIGNING_KEY_PEM'] ?? '' },
    });
    expect(issues.join('\n')).toContain('ADGATE_SIGNING_KEY_PEM');
    expect(failure({ ...PRODUCTION, ADGATE_SIGNING_KEY_PEM: '' }).message).toContain(
      'ADGATE_SIGNING_KEY_PEM',
    );
  });

  it('lists every production problem at once', () => {
    const error = failure({
      ...PRODUCTION,
      PUBLIC_BASE_URL: 'http://localhost:8787',
      ADMIN_PASSWORD: 'change-me',
      METRICS_TOKEN: 'change-me',
    });
    expect(error.issues).toHaveLength(4);
    for (const name of ['PUBLIC_BASE_URL', 'ADMIN_PASSWORD', 'METRICS_TOKEN']) {
      expect(error.message, name).toContain(name);
    }
  });

  it('leaves development and test completely alone', () => {
    const offending = {
      ...MINIMAL,
      PUBLIC_BASE_URL: 'http://localhost:8787',
      ADMIN_PASSWORD: 'change-me',
      METRICS_TOKEN: 'change-me',
    };
    for (const nodeEnv of ['development', 'test']) {
      const config = loadConfig({ ...offending, NODE_ENV: nodeEnv });
      expect(config.adminPassword, nodeEnv).toBe('change-me');
      expect(config.publicBaseUrl, nodeEnv).toBe('http://localhost:8787');
    }
    // The checks themselves only ever describe production, whoever calls them.
    expect(productionIssues(loadConfig(offending))).not.toHaveLength(0);
  });

  it('checks the placeholders it compares against are still the ones in .env.example', () => {
    const example = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');
    for (const [name, value] of Object.entries(EXAMPLE_VALUES)) {
      expect(example, name).toContain(`\n${name}=${value}\n`);
    }
  });
});

/**
 * Warnings are LOGGED, never fatal: a server-to-server deployment really has no browser origin
 * and a deployment with no LLM key really does run rules only. Both are worth one line in a
 * deploy log and neither is worth refusing to start over.
 */
describe('configWarnings', () => {
  const production = (extra: Record<string, string> = {}): GatewayConfig =>
    loadConfig({ ...PRODUCTION, ...extra });

  it('warns when no browser origin may call the gateway', () => {
    const warnings = configWarnings(production());
    expect(warnings.join('\n')).toContain('CORS_ALLOWED_ORIGINS');
    expect(configWarnings(production({ CORS_ALLOWED_ORIGINS: 'https://app.example.com' }))).toEqual(
      configWarnings(production()).filter((line) => !line.includes('CORS_ALLOWED_ORIGINS')),
    );
  });

  it('warns when classification is rules only', () => {
    expect(configWarnings(production()).join('\n')).toContain('no classifier configured');
    const configured = production({
      CLASSIFIER_BASE_URL: 'https://api.openai.com/v1',
      CLASSIFIER_MODEL: 'gpt-4o-mini',
    });
    expect(configWarnings(configured).join('\n')).not.toContain('no classifier configured');
  });

  it('is silent when everything is configured, and outside production', () => {
    expect(
      configWarnings(
        production({
          CORS_ALLOWED_ORIGINS: 'https://app.example.com',
          CLASSIFIER_BASE_URL: 'https://api.openai.com/v1',
          CLASSIFIER_MODEL: 'gpt-4o-mini',
        }),
      ),
    ).toEqual([]);
    expect(configWarnings(loadConfig(MINIMAL))).toEqual([]);
  });
});
