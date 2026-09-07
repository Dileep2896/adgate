import type { Sql } from 'postgres';

import { createDb, type DbHandle, type DbOptions } from './client.js';
import { TABLE_NAMES } from './schema.js';

/**
 * Helpers for integration tests against the docker Postgres test database. Not exported from
 * the package index; test files import it directly.
 */

const MISSING_MESSAGE = [
  'DATABASE_URL_TEST is not set. Integration tests need the Postgres test database:',
  '  1. docker compose up -d postgres',
  '  2. copy .env.example to .env (DATABASE_URL_TEST points at adgate_test; keep the port in sync with PGPORT_HOST)',
  'CI exports DATABASE_URL_TEST in the job environment instead.',
].join('\n');

/** DATABASE_URL_TEST, or a clear failure. The database name must contain "test": it gets truncated. */
export const requireTestDatabaseUrl = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string => {
  const url = env['DATABASE_URL_TEST'];
  if (url === undefined || url.trim() === '') {
    throw new Error(MISSING_MESSAGE);
  }
  const database = url.slice(url.lastIndexOf('/') + 1).split('?')[0] ?? '';
  if (!database.includes('test')) {
    throw new Error(
      `DATABASE_URL_TEST must name a test database (got "${database}"); integration tests truncate every table in it`,
    );
  }
  return url;
};

/**
 * Statement and lock timeouts for integration tests, in ms.
 *
 * WHY TESTS DIFFER FROM PRODUCTION. createDb (db/client.ts) puts a 2000 ms statement_timeout and
 * a 1000 ms lock_timeout on every session on purpose: a wedged connection has to make
 * /v1/evaluate fail closed instead of hanging, and that budget stays exactly where it is for the
 * deployed gateway. It is the wrong budget for a test run. A shared CI runner is oversubscribed,
 * and a query that takes 40 ms on a laptop occasionally takes seconds there, so the production
 * guard fires on a perfectly healthy query and the suite goes red for no reason. That is what
 * happened on 7ae1fc3: one "canceling statement due to statement timeout" in
 * evaluate-errors.integration.test.ts while the other 472 gateway tests passed.
 *
 * WHY 15 s / 10 s. The number has to sit between two failure modes. Too low and a loaded runner
 * trips it on healthy work (the flake). Too high and a genuinely stuck query hangs the file until
 * something else gives up. 15 s is 7.5x the production statement budget - far more than any
 * healthy integration query in this repo needs, even on a busy machine - and still below vitest's
 * 20 s testTimeout (packages/gateway/vitest.config.ts), so a real hang is still bounded and still
 * surfaces as a Postgres cancellation inside the failing test rather than as an opaque runner
 * timeout. lock_timeout stays below statement_timeout for the same reason it does in production:
 * a test blocked on the per-app audit chain lock should say so, not be reported as a slow query.
 *
 * DB_STATEMENT_TIMEOUT_MS / DB_LOCK_TIMEOUT_MS override these when set, which is how CI tunes
 * them without a code change (.github/workflows/ci.yml; they are also declared on turbo.json's
 * test task, without which turbo's strict env mode would strip them before vitest ever ran).
 * Keep any override below the package's vitest testTimeout for the reason above. .env.example
 * leaves both commented out so copying it does not push the production budget into a local run.
 */
export const TEST_STATEMENT_TIMEOUT_MS = 15_000;
export const TEST_LOCK_TIMEOUT_MS = 10_000;

/** A non-negative integer from the environment, or the fallback when unset or unparseable. */
const timeoutFromEnv = (
  name: string,
  fallback: number,
  env: Readonly<Record<string, string | undefined>>,
): number => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

/**
 * The database handle integration tests open. Identical to createDb except for the timeouts
 * above; every other option (notably `max`, which call sites size deliberately) is passed
 * straight through, and a caller that names a timeout itself still wins - migrations pass
 * MIGRATION_DB_OPTIONS and keep their 0.
 */
export const createTestDb = (
  url: string,
  options: DbOptions = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): DbHandle =>
  createDb(url, {
    ...options,
    statementTimeoutMs:
      options.statementTimeoutMs ??
      timeoutFromEnv('DB_STATEMENT_TIMEOUT_MS', TEST_STATEMENT_TIMEOUT_MS, env),
    lockTimeoutMs:
      options.lockTimeoutMs ?? timeoutFromEnv('DB_LOCK_TIMEOUT_MS', TEST_LOCK_TIMEOUT_MS, env),
  });

/** Empties every table in one statement. Call between tests, never against real data. */
export const truncateAllTables = async (sql: Sql): Promise<void> => {
  const list = TABLE_NAMES.map((name) => `"${name}"`).join(', ');
  await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};
