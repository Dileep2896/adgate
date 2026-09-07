import postgres, { type Sql } from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { createTestDb, requireTestDatabaseUrl, truncateAllTables } from '../db/test-support.js';
import { createLogger, type Logger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import {
  RETENTION_ADVISORY_LOCK_KEY,
  RETENTION_RUN_FINISHED,
  RETENTION_RUN_SKIPPED,
  startRetentionScheduler,
  withRetentionLock,
} from './scheduler.js';

/**
 * The advisory lock against real Postgres. The unit tests fake it; this proves the claim the
 * whole design rests on - that a SECOND process cannot prune while a first one is pruning.
 *
 * The "other instance" here is a separate postgres.js connection, which is a separate backend
 * session, exactly like a second container would be. Nothing in this file depends on the
 * retention job finding anything to delete: what is under test is who is allowed to run it.
 */

const url = requireTestDatabaseUrl();
let handle: DbHandle;
/** Stands in for another gateway instance: its own connection, its own session. */
let other: Sql;
let logs: ReturnType<typeof collectLogs>;
let logger: Logger;

const messages = (): string[] =>
  logs.lines.map((line) => String((JSON.parse(line) as { msg?: unknown }).msg));

const entry = (msg: string): Record<string, unknown> | undefined =>
  logs.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((line) => line['msg'] === msg);

/** Takes the lock on the other connection and returns the release. */
const holdLockElsewhere = async (): Promise<() => Promise<void>> => {
  const reserved = await other.reserve();
  const [row] = await reserved<{ locked: boolean }[]>`
    select pg_try_advisory_lock(${RETENTION_ADVISORY_LOCK_KEY}) as locked
  `;
  expect(row?.locked, 'the other session should have got the lock').toBe(true);
  return async () => {
    await reserved`select pg_advisory_unlock(${RETENTION_ADVISORY_LOCK_KEY})`;
    reserved.release();
  };
};

beforeAll(async () => {
  await runMigrations(url);
  handle = createTestDb(url, { max: 4 });
  other = postgres(url, { max: 1, onnotice: () => undefined });
  await truncateAllTables(handle.sql);
});

beforeEach(() => {
  logs = collectLogs();
  logger = createLogger({ level: 'info' }, logs.stream);
});

afterEach(async () => {
  await truncateAllTables(handle.sql);
});

afterAll(async () => {
  await other.end({ timeout: 5 });
  await handle.close();
});

describe('withRetentionLock', () => {
  it('runs the work and lets the next caller in afterwards', async () => {
    expect(await withRetentionLock(handle.sql, () => Promise.resolve('ran'))).toBe('ran');
    expect(await withRetentionLock(handle.sql, () => Promise.resolve('again'))).toBe('again');
  });

  it('answers null instead of running while another session holds the lock', async () => {
    const release = await holdLockElsewhere();
    let called = false;
    try {
      const result = await withRetentionLock(handle.sql, () => {
        called = true;
        return Promise.resolve('ran');
      });
      expect(result).toBeNull();
      expect(called).toBe(false);
    } finally {
      await release();
    }
    // And the moment the other session lets go, the work runs.
    expect(await withRetentionLock(handle.sql, () => Promise.resolve('ran'))).toBe('ran');
  });

  it('releases the lock even when the work throws', async () => {
    await expect(
      withRetentionLock(handle.sql, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await withRetentionLock(handle.sql, () => Promise.resolve('ran'))).toBe('ran');
  });
});

describe('the scheduler against a real database', () => {
  it('skips its run, quietly, while another instance holds the lock', async () => {
    const release = await holdLockElsewhere();
    const scheduler = startRetentionScheduler({
      db: handle.db,
      sql: handle.sql,
      logger,
      intervalHours: 24,
    });
    try {
      await scheduler?.tick();
      expect(entry(RETENTION_RUN_SKIPPED)).toMatchObject({ reason: 'lock_held' });
      expect(messages()).not.toContain(RETENTION_RUN_FINISHED);

      // Same scheduler, same process: once the other instance is gone the next tick runs the
      // real retention job (no apps registered, so it deletes nothing and says so).
      await release();
      await scheduler?.tick();
      expect(entry(RETENTION_RUN_FINISHED)).toMatchObject({ apps: 0, records_deleted: 0 });
    } finally {
      scheduler?.stop();
    }
  });
});
