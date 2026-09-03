import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema.js';

/**
 * The Postgres connection (postgres.js driver under Drizzle). One handle per process; tests
 * create their own against DATABASE_URL_TEST and close it in afterAll.
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

export interface DbOptions {
  /** Pool size. Default 10; migrations and tests use 1 or 2. */
  max?: number | undefined;
}

export const createDb = (url: string, options: DbOptions = {}): DbHandle => {
  const sql = postgres(url, {
    max: options.max ?? 10,
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
