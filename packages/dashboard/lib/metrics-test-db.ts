import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

/**
 * The database the metrics integration test owns. NOT imported by the app - only by
 * lib/metrics-queries.integration.test.ts.
 *
 * WHY ITS OWN DATABASE. `turbo run test` runs the packages in parallel, and the gateway's
 * integration tests truncate every table of DATABASE_URL_TEST between tests. A dashboard test
 * that seeded ten thousand audit records into the same database would be emptied halfway
 * through (and would empty the gateway's fixtures in return), so this one appends `_dashboard`
 * to the test database name and creates that database on first use. It is still obviously a
 * test database, and it is truncated freely.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '..', '..', 'gateway', 'drizzle');

/** Postgres error code for `duplicate_database`: another worker got there first. */
const DUPLICATE_DATABASE = '42P04';

export const metricsTestDatabaseUrl = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string => {
  const base = env['DATABASE_URL_TEST'];
  if (base === undefined || base.trim() === '') {
    throw new Error(
      'DATABASE_URL_TEST is not set. Run `docker compose up -d postgres` and copy .env.example to .env.',
    );
  }
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '');
  if (!name.includes('test')) {
    throw new Error(
      `DATABASE_URL_TEST must name a test database (got "${name}"); this suite truncates every table in it`,
    );
  }
  url.pathname = `/${name}_dashboard`;
  return url.toString();
};

/** Creates the database when it does not exist yet, then applies the gateway's migrations. */
export const prepareMetricsTestDatabase = async (url: string): Promise<void> => {
  const target = new URL(url);
  const name = target.pathname.replace(/^\//, '');
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const adminSql = postgres(admin.toString(), { max: 1, connect_timeout: 5 });
  try {
    await adminSql.unsafe(`create database "${name.replace(/"/g, '""')}"`);
  } catch (error) {
    if ((error as { code?: string }).code !== DUPLICATE_DATABASE) {
      throw error;
    }
  } finally {
    await adminSql.end({ timeout: 5 });
  }
  const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await sql.end({ timeout: 5 });
  }
};

/** A plain read-write client for seeding. The app itself never writes (lib/db.ts). */
export const openSeedClient = (url: string): Sql =>
  postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
