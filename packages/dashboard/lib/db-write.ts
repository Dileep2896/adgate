import type { Db } from '@adgateio/gateway/admin';
import * as schema from '@adgateio/gateway/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

/**
 * The dashboard's SECOND Postgres handle - the only one that can write.
 *
 * WHY THERE ARE TWO. lib/db.ts opens its pool with `default_transaction_read_only`, so every
 * page, every query in lib/queries.ts and every future report physically cannot modify the
 * gateway's database: the audit chain is signed and hash linked, and a dashboard that could
 * edit it would defeat the point of signing it. That guarantee is only worth having if it is
 * the default, so admin writes do not loosen it - they use a different connection.
 *
 * This handle is imported by the admin server actions and nothing else (lib/db-write-usage.test.ts
 * holds the list and fails when it grows). The writes they carry out are not hand written SQL
 * either: they run the gateway's own registerApp / issueApiKey / revokeApiKey / createCreative /
 * updateCreative / setCreativeActive (`@adgateio/gateway/admin`) plus one UPDATE of
 * apps.policy_yaml.
 *
 * Read paths must keep using dashboardDb() from lib/db.ts.
 */

export type DashboardWriteDb = Db;

export interface DashboardWriteDbHandle {
  db: DashboardWriteDb;
  sql: Sql;
  close: () => Promise<void>;
}

/** Two connections is plenty: an operator clicking Save is not concurrent traffic. */
export const WRITE_POOL_MAX = 2;
/**
 * Longer than the read pool's budget: registerApp hashes the new API key with argon2id inside
 * its transaction, which deliberately costs tens of milliseconds.
 */
export const WRITE_STATEMENT_TIMEOUT_MS = 15_000;
export const WRITE_CONNECT_TIMEOUT_S = 5;

export const createWriteDb = (url: string): DashboardWriteDbHandle => {
  const sql = postgres(url, {
    max: WRITE_POOL_MAX,
    connect_timeout: WRITE_CONNECT_TIMEOUT_S,
    connection: { statement_timeout: WRITE_STATEMENT_TIMEOUT_MS },
    onnotice: () => undefined,
  });
  return { db: drizzle(sql, { schema }), sql, close: () => sql.end({ timeout: 5 }) };
};

/**
 * One handle per process, hung off globalThis so `next dev` module reloads do not open a new
 * pool on every recompile. Created on first admin action, never at import time, so `next
 * build` runs without a database.
 */
const globalForWriteDb = globalThis as unknown as {
  adgateDashboardWriteDb?: DashboardWriteDbHandle;
};

export const dashboardWriteDb = (databaseUrl: string): DashboardWriteDb => {
  const existing = globalForWriteDb.adgateDashboardWriteDb;
  if (existing !== undefined) {
    return existing.db;
  }
  const handle = createWriteDb(databaseUrl);
  globalForWriteDb.adgateDashboardWriteDb = handle;
  return handle.db;
};
