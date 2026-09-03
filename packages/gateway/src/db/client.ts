import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema.js';

/**
 * The Postgres connection (postgres.js driver under Drizzle). One handle per process; tests
 * create their own against DATABASE_URL_TEST and close it in afterAll. Every session carries
 * a statement_timeout and a lock_timeout (DB_STATEMENT_TIMEOUT_MS / DB_LOCK_TIMEOUT_MS), so a
 * wedged connection or a lock holder errors instead of hanging a request: the error rolls the
 * transaction back and the evaluate pipeline answers suppress/error (fail closed). Migrations
 * pass 0 (no limit): a backfill may legitimately take longer than a request budget.
 */

export type Db = PostgresJsDatabase<typeof schema>;

/** A database handle or the transaction handle db.transaction() hands its callback: same query API. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  /** The raw postgres.js client for statements Drizzle has no builder for. */
  sql: Sql;
  /** Ends every connection; resolves once the pool is drained (bounded by a short timeout). */
  close: () => Promise<void>;
}

export const DEFAULT_POOL_MAX = 10;
/** Postgres statement_timeout per session, ms. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 2_000;
/** Postgres lock_timeout per session, ms: how long a request waits for the per-app audit lock. */
export const DEFAULT_LOCK_TIMEOUT_MS = 1_000;
/** Seconds to wait for a new connection before the driver gives up. */
export const CONNECT_TIMEOUT_S = 5;

export interface DbOptions {
  /** Pool size. Default 10; migrations and tests use 1 or 2. */
  max?: number | undefined;
  /** statement_timeout in ms; 0 disables it. Default DEFAULT_STATEMENT_TIMEOUT_MS. */
  statementTimeoutMs?: number | undefined;
  /** lock_timeout in ms; 0 disables it. Default DEFAULT_LOCK_TIMEOUT_MS. */
  lockTimeoutMs?: number | undefined;
}

/** The options migrations run with: one connection and no timeouts. */
export const MIGRATION_DB_OPTIONS: Readonly<DbOptions> = Object.freeze({
  max: 1,
  statementTimeoutMs: 0,
  lockTimeoutMs: 0,
});

export const createDb = (url: string, options: DbOptions = {}): DbHandle => {
  const sql = postgres(url, {
    max: options.max ?? DEFAULT_POOL_MAX,
    connect_timeout: CONNECT_TIMEOUT_S,
    connection: {
      statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
      lock_timeout: options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
    },
    // Postgres NOTICEs (e.g. "relation already exists, skipping") would otherwise hit stderr.
    onnotice: () => undefined,
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
};
