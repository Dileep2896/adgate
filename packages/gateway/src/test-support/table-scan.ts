import type { DbHandle } from '../db/client.js';
import { TABLE_NAMES } from '../db/schema.js';

/**
 * "Is this string anywhere in the database?", asked of Postgres rather than of a list of places
 * somebody remembered to check. The privacy claim in docs/privacy.md - no raw conversation text
 * is persisted unless policy.privacy.store_raw_text is true - is only worth as much as the
 * search behind it, so the search is driven by the catalog: every table in the public schema,
 * every column of a type that could hold text.
 *
 * That is deliberately not "every column the Drizzle schema declares". A column added by a
 * migration and forgotten in a table module, or a whole table a later story adds without
 * touching this file, is exactly what an exhaustive scan has to catch - so it reads
 * information_schema, and tableNamesInDatabase() lets a test assert the ORM's list agrees.
 *
 * Test-only: nothing that serves traffic imports this.
 */

/** Column types that can carry text. json/jsonb are cast to their text form before searching. */
const TEXTUAL_TYPES = ['text', 'character varying', 'character', 'json', 'jsonb'];

export interface TableColumn {
  table: string;
  column: string;
  dataType: string;
}

/** Every table of the public schema, as Postgres reports it (Drizzle's list is not consulted). */
export const tableNamesInDatabase = async (handle: DbHandle): Promise<string[]> => {
  const rows = await handle.sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `;
  return rows.map((row) => row.table_name);
};

/** Every text, varchar, json or jsonb column of the public schema, table then column. */
export const textualColumns = async (handle: DbHandle): Promise<TableColumn[]> => {
  const rows = await handle.sql<{ table_name: string; column_name: string; data_type: string }[]>`
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and c.data_type = any(${TEXTUAL_TYPES})
    order by c.table_name, c.column_name
  `;
  return rows.map((row) => ({
    table: row.table_name,
    column: row.column_name,
    dataType: row.data_type,
  }));
};

const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

/**
 * `table.column` for every textual column holding a value that contains `needle`, checked with
 * position() so a needle containing % or _ is matched literally.
 */
export const columnsContaining = async (handle: DbHandle, needle: string): Promise<string[]> => {
  const hits: string[] = [];
  for (const column of await textualColumns(handle)) {
    const rows = await handle.sql.unsafe<{ hit: number }[]>(
      `select 1 as hit from ${quote(column.table)}
       where position($1 in ${quote(column.column)}::text) > 0 limit 1`,
      [needle],
    );
    if (rows.length > 0) {
      hits.push(`${column.table}.${column.column}`);
    }
  }
  return hits;
};

/** The tables whose rows, serialised as JSON, contain `needle` anywhere. */
export const tablesContaining = async (handle: DbHandle, needle: string): Promise<string[]> => {
  const hits: string[] = [];
  for (const name of TABLE_NAMES) {
    const rows = await handle.sql.unsafe<{ row: string }[]>(
      `select row_to_json(t)::text as row from ${quote(name)} t`,
    );
    if (rows.some((row) => row.row.includes(needle))) {
      hits.push(name);
    }
  }
  return hits;
};
