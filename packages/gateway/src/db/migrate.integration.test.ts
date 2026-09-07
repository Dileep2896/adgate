import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type DbHandle, MIGRATION_DB_OPTIONS } from './client.js';
import { findMigrationsDir, runMigrations } from './migrate.js';
import { TABLE_NAMES } from './schema.js';
import { createTestDb, requireTestDatabaseUrl, truncateAllTables } from './test-support.js';

/**
 * The migrations apply from nothing (a fresh clone, CI) and 0001_audit_seq.sql is safe on a
 * database that already holds audit records: the column arrives nullable, existing rows are
 * numbered per app in chain order, then the unique index and NOT NULL follow.
 */
const url = requireTestDatabaseUrl();

const statementsOf = (file: string): string[] =>
  readFileSync(join(findMigrationsDir(), file), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');

const seqColumn = async (handle: DbHandle) => {
  const [column] = await handle.sql<{ is_nullable: string }[]>`
    select is_nullable from information_schema.columns
    where table_name = 'audit_records' and column_name = 'seq'
  `;
  const [index] = await handle.sql<{ indexdef: string }[]>`
    select indexdef from pg_indexes where indexname = 'audit_records_app_id_seq_uidx'
  `;
  return { nullable: column?.is_nullable, index: index?.indexdef };
};

describe('migrations', () => {
  it('apply from an empty database', async () => {
    const admin = createTestDb(url, MIGRATION_DB_OPTIONS);
    try {
      await admin.sql.unsafe(
        'drop schema public cascade; create schema public; drop schema if exists drizzle cascade',
      );
    } finally {
      await admin.close();
    }
    await runMigrations(url);
    const handle = createTestDb(url, { max: 1 });
    try {
      const rows = await handle.sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
      `;
      expect(rows.map((row) => row.table_name).sort()).toEqual([...TABLE_NAMES].sort());
      const [applied] = await handle.sql<{ n: number }[]>`
        select count(*)::int as n from drizzle.__drizzle_migrations
      `;
      expect(applied?.n).toBe(7);
      expect(await seqColumn(handle)).toEqual({
        nullable: 'NO',
        index: expect.stringMatching(/UNIQUE.*\(app_id, seq\)/s),
      });
    } finally {
      await handle.close();
    }
  });

  it('0001_audit_seq backfills seq per app in ts order for pre-existing records', async () => {
    const handle = createTestDb(url, MIGRATION_DB_OPTIONS);
    try {
      await truncateAllTables(handle.sql);
      await handle.sql.unsafe('alter table audit_records drop column seq');
      expect((await seqColumn(handle)).index).toBeUndefined();
      for (const id of ['app_A', 'app_B']) {
        await handle.sql`
          insert into apps (id, name, salt, policy_yaml, policy_hash)
          values (${id}, ${id}, ${'ab'.repeat(32)}, ${`app_id: ${id}\n`}, ${'sha256:' + '0'.repeat(64)})
        `;
      }
      // Inserted out of chain order on purpose: the backfill must follow ts, not insertion.
      const rows: [string, string, string][] = [
        ['app_A', 'aud_A3', '2026-09-01T00:00:03Z'],
        ['app_B', 'aud_B2', '2026-09-01T00:00:02Z'],
        ['app_A', 'aud_A1', '2026-09-01T00:00:01Z'],
        ['app_A', 'aud_A2', '2026-09-01T00:00:02Z'],
        ['app_B', 'aud_B1', '2026-09-01T00:00:01Z'],
      ];
      for (const [appId, id, ts] of rows) {
        await handle.sql`
          insert into audit_records (record_hash, id, app_id, prev_hash, decision, ts, record)
          values (${'sha256:' + id}, ${id}, ${appId}, ${'genesis'}, ${'suppress'}, ${ts}::timestamptz, ${'{}'}::jsonb)
        `;
      }
      for (const statement of statementsOf('0001_audit_seq.sql')) {
        await handle.sql.unsafe(statement);
      }
      const numbered = await handle.sql<{ app_id: string; id: string; seq: number }[]>`
        select app_id, id, seq from audit_records order by app_id, seq
      `;
      expect(numbered).toEqual([
        { app_id: 'app_A', id: 'aud_A1', seq: 1 },
        { app_id: 'app_A', id: 'aud_A2', seq: 2 },
        { app_id: 'app_A', id: 'aud_A3', seq: 3 },
        { app_id: 'app_B', id: 'aud_B1', seq: 1 },
        { app_id: 'app_B', id: 'aud_B2', seq: 2 },
      ]);
      expect(await seqColumn(handle)).toEqual({
        nullable: 'NO',
        index: expect.stringMatching(/UNIQUE.*\(app_id, seq\)/s),
      });
    } finally {
      await truncateAllTables(handle.sql);
      await handle.close();
    }
  });
});
