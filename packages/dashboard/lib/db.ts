import * as schema from '@adgateio/gateway/schema';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { dashboardEnv } from './env';

/**
 * The dashboard's Postgres handle. It is the SAME database the gateway writes (DATABASE_URL)
 * and the SAME Drizzle table definitions, imported from the gateway's `./schema` subpath so
 * there is exactly one copy of the schema in the repo.
 *
 * READ ONLY. Every query in this package is a SELECT (lib/queries.ts); the dashboard never
 * inserts, updates or deletes. The connection asks Postgres to enforce that too
 * (default_transaction_read_only), so a stray write fails loudly instead of corrupting the
 * audit chain the gateway is responsible for. Later stories that need to write (create an app,
 * edit a policy) must add their own read-write handle rather than loosening this one.
 */

export type DashboardDb = PostgresJsDatabase<typeof schema>;

export interface DashboardDbHandle {
  db: DashboardDb;
  sql: Sql;
  close: () => Promise<void>;
}

/** Small pool: the dashboard is one operator, not traffic. */
export const DASHBOARD_POOL_MAX = 4;
export const DASHBOARD_STATEMENT_TIMEOUT_MS = 10_000;
export const CONNECT_TIMEOUT_S = 5;

/**
 * The statement_timeout the integration suites in this directory open their handles with,
 * instead of the two production budgets above.
 *
 * Same reasoning as the gateway's test factory (packages/gateway/src/db/test-support.ts), and
 * deliberately the same number: a shared CI runner under load is slow enough to cancel a healthy
 * query inside a budget that is generous in production, and DB_STATEMENT_TIMEOUT_MS is the one
 * knob CI turns for both packages. It stays well below this package's 30 s vitest testTimeout so
 * a genuinely wedged query is still bounded. The production handles are untouched: pages keep
 * 10 s and admin writes keep 15 s.
 */
export const TEST_STATEMENT_TIMEOUT_MS = 15_000;

/** DB_STATEMENT_TIMEOUT_MS when it holds a non-negative integer, else TEST_STATEMENT_TIMEOUT_MS. */
export const testStatementTimeoutMs = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): number => {
  const raw = env['DB_STATEMENT_TIMEOUT_MS'];
  if (raw === undefined || raw.trim() === '') {
    return TEST_STATEMENT_TIMEOUT_MS;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : TEST_STATEMENT_TIMEOUT_MS;
};

export const createReadOnlyDb = (
  url: string,
  statementTimeoutMs: number = DASHBOARD_STATEMENT_TIMEOUT_MS,
): DashboardDbHandle => {
  const sql = postgres(url, {
    max: DASHBOARD_POOL_MAX,
    connect_timeout: CONNECT_TIMEOUT_S,
    connection: {
      statement_timeout: statementTimeoutMs,
      default_transaction_read_only: true,
    },
    onnotice: () => undefined,
  });
  return { db: drizzle(sql, { schema }), sql, close: () => sql.end({ timeout: 5 }) };
};

/**
 * One handle per process, hung off globalThis so `next dev` module reloads do not open a new
 * pool on every recompile. Created on first query, never at import time, so `next build` runs
 * without a database.
 */
const globalForDb = globalThis as unknown as { adgateDashboardDb?: DashboardDbHandle };

export const dashboardDb = (): DashboardDb => {
  const existing = globalForDb.adgateDashboardDb;
  if (existing !== undefined) {
    return existing.db;
  }
  const handle = createReadOnlyDb(dashboardEnv().databaseUrl);
  globalForDb.adgateDashboardDb = handle;
  return handle.db;
};
