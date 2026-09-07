import { HealthResponse } from '@adgateio/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createDb, type DbHandle } from './db/client.js';
import { findMigrationsDir, runMigrations } from './db/migrate.js';
import { TABLE_NAMES } from './db/schema.js';
import { requireTestDatabaseUrl, truncateAllTables } from './db/test-support.js';
import { createLogger } from './logger.js';
import { collectLogs } from './test-support/logs.js';

/**
 * Runs against the docker Postgres test database named by DATABASE_URL_TEST (vitest.setup.ts
 * loads the repo-root .env; CI exports the variable). Migrations are applied once before the
 * tests and every table is truncated, so a stale database never leaks into the assertions.
 */
const url = requireTestDatabaseUrl();
let handle: DbHandle;

beforeAll(async () => {
  await runMigrations(url);
  handle = createDb(url, { max: 2 });
  await truncateAllTables(handle.sql);
});

afterAll(async () => {
  await handle.close();
});

describe('migrations', () => {
  it('ship SQL and a journal inside packages/gateway/drizzle', () => {
    expect(findMigrationsDir()).toMatch(/packages\/gateway\/drizzle$/);
  });

  it('create every table', async () => {
    const rows = await handle.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    const names = rows.map((row) => row.table_name).sort();
    expect(names).toEqual([...TABLE_NAMES].sort());
    expect(names).toEqual(
      expect.arrayContaining([
        'apps',
        'api_keys',
        'advertisers',
        'creatives',
        'audit_records',
        'events',
        'cap_state',
        'user_day_caps',
        'classify_cache',
        'raw_text',
        'rate_limits',
      ]),
    );
  });

  it('create the required indexes and primary keys', async () => {
    const rows = await handle.sql<{ tablename: string; indexname: string; indexdef: string }[]>`
      select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'
    `;
    const definition = (name: string): string => {
      const row = rows.find((candidate) => candidate.indexname === name);
      if (row === undefined) {
        throw new Error(`index ${name} missing; have ${rows.map((r) => r.indexname).join(', ')}`);
      }
      return row.indexdef;
    };
    expect(definition('audit_records_app_id_ts_idx')).toContain('(app_id, ts)');
    expect(definition('events_audit_id_idx')).toContain('(audit_id)');
    expect(definition('cap_state_pkey')).toContain('(app_id, conversation_hash)');
    expect(definition('classify_cache_expires_at_idx')).toContain('(expires_at)');
    expect(definition('user_day_caps_pkey')).toContain('(app_id, user_hash, day)');
    expect(definition('audit_records_one_latest_per_id_uidx')).toMatch(/UNIQUE.*WHERE/s);
    expect(definition('events_one_impression_per_audit_uidx')).toMatch(/UNIQUE.*WHERE/s);
    expect(definition('audit_records_app_id_seq_uidx')).toMatch(/UNIQUE.*\(app_id, seq\)/s);
  });

  it('are idempotent', async () => {
    await expect(runMigrations(url)).resolves.toBeUndefined();
  });
});

describe('GET /healthz', () => {
  it('returns { ok: true } from an app wired to the test database', async () => {
    const { stream } = collectLogs();
    const app = createApp({
      logger: createLogger({ level: 'silent' }, stream),
      corsAllowedOrigins: [],
      db: handle.db,
    });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({ ok: true });
  });
});
