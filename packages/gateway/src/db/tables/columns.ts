import { sql } from 'drizzle-orm';
import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Column helpers shared by the table modules. Times are timestamptz (CLAUDE.md) and surface as
 * Date objects; convert with toISOString() at the API boundary. Not a table module: drizzle-kit
 * reads this file through the tables/*.ts glob and finds no tables in it.
 */

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => timestamptz('created_at').notNull().defaultNow();

export const updatedAt = () => timestamptz('updated_at').notNull().defaultNow();

/** `'a', 'b', 'c'` for a CHECK (col IN (...)) built from a contract enum. */
export const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', '));
