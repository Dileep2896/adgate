import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '../db/client.js';
import { createLogger, type Logger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import type { RetentionSummary } from './run.js';
import {
  HOUR_MS,
  RETENTION_FIRST_RUN_DELAY_MS,
  RETENTION_RUN_FAILED,
  RETENTION_RUN_FINISHED,
  RETENTION_RUN_SKIPPED,
  RETENTION_SCHEDULED,
  RETENTION_SCHEDULER_STOPPED,
  startRetentionScheduler,
} from './scheduler.js';

/**
 * The scheduler's own behaviour, with the clock faked and no database: WHEN it runs, what it
 * does when it cannot get the lock, and the one thing it must never do - throw. The advisory
 * lock itself is real Postgres behaviour and is proved in retention-scheduler.integration.test.ts.
 */

const SUMMARY: RetentionSummary = {
  dry_run: false,
  now: '2026-09-05T00:00:00.000Z',
  apps: [],
  totals: {
    apps: 3,
    pruned: 1,
    skipped: 1,
    failed: 0,
    records_deleted: 12,
    events_deleted: 4,
    raw_text_deleted: 2,
  },
};

interface FakeSql {
  sql: Sql;
  state: { reserved: number; released: number; unlocked: number };
}

/**
 * Just enough of postgres.js for withRetentionLock: reserve() hands back a tagged-template
 * function with a release(). `locked` is what pg_try_advisory_lock answers.
 */
const fakeSql = (locked: boolean): FakeSql => {
  const state = { reserved: 0, released: 0, unlocked: 0 };
  const reserve = (): Promise<unknown> => {
    state.reserved += 1;
    const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
      if (strings.join('').includes('pg_advisory_unlock')) {
        state.unlocked += 1;
        return Promise.resolve([{ unlocked: true }]);
      }
      return Promise.resolve([{ locked }]);
    };
    return Promise.resolve(
      Object.assign(tag, {
        release: () => {
          state.released += 1;
        },
      }),
    );
  };
  return { sql: { reserve } as unknown as Sql, state };
};

const DB = {} as Db;

let logs: ReturnType<typeof collectLogs>;
let logger: Logger;

const entries = (): Record<string, unknown>[] =>
  logs.lines.map((line) => JSON.parse(line) as Record<string, unknown>);

const messages = (): string[] => entries().map((entry) => String(entry['msg']));

beforeEach(() => {
  vi.useFakeTimers();
  logs = collectLogs();
  logger = createLogger({ level: 'info' }, logs.stream);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startRetentionScheduler', () => {
  it('registers nothing at all when the interval is 0', () => {
    const { sql, state } = fakeSql(true);
    const run = vi.fn(() => Promise.resolve(SUMMARY));
    for (const intervalHours of [0, -1]) {
      expect(startRetentionScheduler({ db: DB, sql, logger, intervalHours, run })).toBeNull();
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(state.reserved).toBe(0);
    expect(messages()).not.toContain(RETENTION_SCHEDULED);
  });

  it('runs shortly after boot and then once per interval', async () => {
    const { sql } = fakeSql(true);
    const run = vi.fn(() => Promise.resolve(SUMMARY));
    const scheduler = startRetentionScheduler({ db: DB, sql, logger, intervalHours: 6, run });
    expect(scheduler).not.toBeNull();
    expect(messages()).toContain(RETENTION_SCHEDULED);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * HOUR_MS);
    expect(run).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(6 * HOUR_MS);
    expect(run).toHaveBeenCalledTimes(3);

    scheduler?.stop();
  });

  it('logs one summary of counts per run and nothing that could be content', async () => {
    const { sql } = fakeSql(true);
    const scheduler = startRetentionScheduler({
      db: DB,
      sql,
      logger,
      intervalHours: 24,
      firstRunDelayMs: 10,
      run: () => Promise.resolve(SUMMARY),
    });
    await vi.advanceTimersByTimeAsync(10);
    const summary = entries().find((entry) => entry['msg'] === RETENTION_RUN_FINISHED);
    expect(summary).toBeDefined();
    expect(summary).toMatchObject(SUMMARY.totals);
    expect(summary).toHaveProperty('duration_ms');
    // Counts, positions and a duration - nothing else. `apps` here is the COUNT of apps, not
    // the per-app array, so no app id or policy reaches the line.
    expect(
      Object.keys(summary ?? {})
        .filter((key) => !['level', 'time', 'service', 'msg'].includes(key))
        .sort(),
    ).toEqual([...Object.keys(SUMMARY.totals), 'duration_ms'].sort());
    scheduler?.stop();
  });

  it('skips quietly when another instance holds the advisory lock', async () => {
    const { sql, state } = fakeSql(false);
    const run = vi.fn(() => Promise.resolve(SUMMARY));
    const scheduler = startRetentionScheduler({
      db: DB,
      sql,
      logger,
      intervalHours: 24,
      firstRunDelayMs: 10,
      run,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(run).not.toHaveBeenCalled();
    const skip = entries().find((entry) => entry['msg'] === RETENTION_RUN_SKIPPED);
    expect(skip).toMatchObject({ reason: 'lock_held' });
    // The reserved connection goes back to the pool either way, and nothing was unlocked.
    expect(state.released).toBe(1);
    expect(state.unlocked).toBe(0);
    expect(messages()).not.toContain(RETENTION_RUN_FAILED);
    scheduler?.stop();
  });

  it('releases the lock and the connection after a successful run', async () => {
    const { sql, state } = fakeSql(true);
    const scheduler = startRetentionScheduler({
      db: DB,
      sql,
      logger,
      intervalHours: 24,
      firstRunDelayMs: 10,
      run: () => Promise.resolve(SUMMARY),
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(state).toEqual({ reserved: 1, released: 1, unlocked: 1 });
    scheduler?.stop();
  });

  it('never throws when a run fails, and keeps running afterwards', async () => {
    const { sql, state } = fakeSql(true);
    const run = vi
      .fn<() => Promise<RetentionSummary>>()
      .mockRejectedValueOnce(new TypeError('database went away'))
      .mockResolvedValue(SUMMARY);
    const scheduler = startRetentionScheduler({
      db: DB,
      sql,
      logger,
      intervalHours: 1,
      firstRunDelayMs: 10,
      run,
    });
    // No unhandled rejection, no thrown error: the tick resolves.
    await expect(scheduler?.tick()).resolves.toBeUndefined();
    const failure = entries().find((entry) => entry['msg'] === RETENTION_RUN_FAILED);
    expect(failure).toMatchObject({ error_name: 'TypeError', level: 50 });
    // The message is never logged: a driver error can quote the statement that failed.
    expect(logs.lines.join('\n')).not.toContain('database went away');
    // The lock is still released when the work throws, or the next run could never start.
    expect(state.released).toBe(1);
    expect(state.unlocked).toBe(1);

    await vi.advanceTimersByTimeAsync(HOUR_MS + 10);
    expect(messages()).toContain(RETENTION_RUN_FINISHED);
    scheduler?.stop();
  });

  it('does not start a second run while one is still going', async () => {
    const { sql, state } = fakeSql(true);
    let release: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<RetentionSummary>((resolve) => {
          release = () => resolve(SUMMARY);
        }),
    );
    const scheduler = startRetentionScheduler({
      db: DB,
      sql,
      logger,
      intervalHours: 24,
      firstRunDelayMs: 10,
      run,
    });
    const first = scheduler?.tick();
    await Promise.resolve();
    const second = scheduler?.tick();
    await second;
    expect(run).toHaveBeenCalledTimes(1);
    expect(entries().find((entry) => entry['msg'] === RETENTION_RUN_SKIPPED)).toMatchObject({
      reason: 'already_running',
    });
    expect(state.reserved).toBe(1);
    release?.();
    await first;
    scheduler?.stop();
  });

  it('clears both timers on stop, twice over', async () => {
    const { sql } = fakeSql(true);
    const run = vi.fn(() => Promise.resolve(SUMMARY));
    const scheduler = startRetentionScheduler({
      db: DB,
      sql,
      logger,
      intervalHours: 1,
      firstRunDelayMs: 10,
      run,
    });
    expect(vi.getTimerCount()).toBe(2);
    scheduler?.stop();
    scheduler?.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(messages()).toContain(RETENTION_SCHEDULER_STOPPED);
    await vi.advanceTimersByTimeAsync(10 * HOUR_MS);
    expect(run).not.toHaveBeenCalled();
  });
});
