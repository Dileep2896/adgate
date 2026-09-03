import type { Sql } from 'postgres';

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

/** Empties every table in one statement. Call between tests, never against real data. */
export const truncateAllTables = async (sql: Sql): Promise<void> => {
  const list = TABLE_NAMES.map((name) => `"${name}"`).join(', ');
  await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};
