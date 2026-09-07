import type { Sql } from 'postgres';

import type { Db } from '../db/client.js';
import type { Logger } from '../logger.js';
import { type RetentionSummary, runRetention } from './run.js';

/**
 * The in-process retention scheduler (RETENTION_INTERVAL_HOURS). A free-tier host has nowhere to
 * put a crontab, so the gateway can run its own retention job on a timer instead of leaving
 * `privacy.retain_days` as a promise nobody keeps. `pnpm --filter @adgateio/gateway retention` from
 * cron is still the better answer wherever cron exists; this is the fallback, and 0 (the default)
 * turns it off entirely so nothing changes for a deployment that already has cron.
 *
 * FOUR RULES.
 *  1. One runner at a time, ACROSS PROCESSES. Two instances behind a load balancer, or the old
 *     and new container overlapping during a rolling deploy, would otherwise prune the same
 *     chains concurrently. Every run first takes a session-level pg_try_advisory_lock on a
 *     reserved connection; a run that does not get it logs one line and does nothing.
 *  2. Never crash the process. The job is background work: a failed run is an error log and the
 *     next tick tries again. An unhandled rejection here would take the whole gateway down and
 *     turn a retention problem into an outage.
 *  3. Counts, never content (docs/privacy.md). The per-run summary carries totals and an error
 *     CLASS; no ids of deleted rows, no policy text, no messages.
 *  4. The timer is cleared on shutdown, so SIGTERM does not leave a run mid-flight holding a
 *     lock while the pool closes underneath it.
 *
 * DB_STATEMENT_TIMEOUT_MS (default 2000 ms) applies to these runs exactly as it does to a
 * request: they use the gateway's own pool. A first run over a long backlog can exceed it and
 * come back as a `failed` app; the next run picks up where it stopped, because deletion is a
 * prefix of each chain and the watermark is committed with it. See docs/deploy.md.
 */

/**
 * The 64-bit key every gateway instance takes before pruning. Arbitrary but FIXED: its only job
 * is to be a number no other application sharing this database uses, and to never change - two
 * gateway versions with different keys would not see each other and could prune at once.
 * Nothing else in adgate takes an advisory lock.
 */
export const RETENTION_ADVISORY_LOCK_KEY = 5_243_015_071;

export const HOUR_MS = 3_600_000;

/**
 * How long after boot the first run happens. Long enough that a restart loop does not hammer the
 * database and that a rolling deploy's old instance has usually gone, short enough that a
 * scheduled deployment proves itself in the first deploy log rather than hours later.
 */
export const RETENTION_FIRST_RUN_DELAY_MS = 60_000;

export const RETENTION_SCHEDULED = 'retention scheduler started';
export const RETENTION_RUN_FINISHED = 'retention scheduled run finished';
export const RETENTION_RUN_SKIPPED = 'retention scheduled run skipped';
export const RETENTION_RUN_FAILED = 'retention scheduled run failed';
export const RETENTION_SCHEDULER_STOPPED = 'retention scheduler stopped';

/** Why a tick did no work. Both are normal, and both are one info line. */
export type RetentionSkipReason =
  /** Another instance (or the previous container during a deploy) holds the advisory lock. */
  | 'lock_held'
  /** This process's own previous run has not finished yet. */
  | 'already_running';

const errorName = (error: unknown): string =>
  error instanceof Error && error.name.length > 0 ? error.name : 'NonError';

/**
 * Runs `work` while holding the retention advisory lock, on a connection reserved out of the
 * pool for exactly that purpose. Returns null when the lock is already held.
 *
 * The lock is SESSION level, not transaction level: the job is many transactions, one per app,
 * and a transaction-level lock would be released by the first commit. That is also why the
 * connection is reserved - a session lock taken on a pooled connection would be handed to
 * whichever request borrowed it next.
 */
export const withRetentionLock = async <T>(sql: Sql, work: () => Promise<T>): Promise<T | null> => {
  const reserved = await sql.reserve();
  try {
    const [row] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${RETENTION_ADVISORY_LOCK_KEY}) as locked
    `;
    if (row?.locked !== true) {
      return null;
    }
    try {
      return await work();
    } finally {
      await reserved`select pg_advisory_unlock(${RETENTION_ADVISORY_LOCK_KEY})`;
    }
  } finally {
    reserved.release();
  }
};

export interface RetentionSchedulerOptions {
  db: Db;
  /** The raw postgres.js client from the same DbHandle as `db`: the lock needs sql.reserve(). */
  sql: Sql;
  logger: Logger;
  /** config.retentionIntervalHours. 0 or less registers no timer at all. */
  intervalHours: number;
  /** Delay before the run that happens shortly after boot. Default RETENTION_FIRST_RUN_DELAY_MS. */
  firstRunDelayMs?: number | undefined;
  /** Test seam: the retention job itself. Defaults to runRetention over `db`. */
  run?: ((db: Db, logger: Logger) => Promise<RetentionSummary>) | undefined;
}

export interface RetentionScheduler {
  /** Clears both timers. Idempotent, so a double shutdown is harmless. */
  stop: () => void;
  /**
   * One tick, exactly as the timers call it: takes the lock, runs, logs. NEVER rejects - a
   * failure is an error log and a resolved promise. Exposed so a test can await a tick.
   */
  tick: () => Promise<void>;
}

const defaultRun = (db: Db, logger: Logger): Promise<RetentionSummary> =>
  runRetention(db, { logger });

/**
 * Registers the timers and returns a handle, or null when RETENTION_INTERVAL_HOURS is 0 - in
 * which case nothing at all is scheduled and the process behaves exactly as it did before.
 */
export const startRetentionScheduler = (
  options: RetentionSchedulerOptions,
): RetentionScheduler | null => {
  const { db, sql, logger, intervalHours } = options;
  if (!(intervalHours > 0)) {
    return null;
  }
  const intervalMs = intervalHours * HOUR_MS;
  const firstRunDelayMs = options.firstRunDelayMs ?? RETENTION_FIRST_RUN_DELAY_MS;
  const run = options.run ?? defaultRun;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) {
      logger.info(
        { reason: 'already_running' satisfies RetentionSkipReason },
        RETENTION_RUN_SKIPPED,
      );
      return;
    }
    running = true;
    const startedAt = Date.now();
    try {
      const summary = await withRetentionLock(sql, () => run(db, logger));
      if (summary === null) {
        logger.info({ reason: 'lock_held' satisfies RetentionSkipReason }, RETENTION_RUN_SKIPPED);
        return;
      }
      logger.info(
        { ...summary.totals, duration_ms: Date.now() - startedAt },
        RETENTION_RUN_FINISHED,
      );
    } catch (error) {
      // Deliberately swallowed: see rule 2. The error CLASS only - a driver message can quote
      // the statement that failed.
      logger.error({ error_name: errorName(error) }, RETENTION_RUN_FAILED);
    } finally {
      running = false;
    }
  };

  // void: the timer callbacks must not return a promise nobody awaits into Node's timer queue,
  // and tick() already resolves whatever happens.
  const first = setTimeout(() => void tick(), firstRunDelayMs);
  const repeat = setInterval(() => void tick(), intervalMs);
  first.unref();
  repeat.unref();

  logger.info(
    { interval_hours: intervalHours, first_run_in_ms: firstRunDelayMs },
    RETENTION_SCHEDULED,
  );

  return {
    stop: () => {
      clearTimeout(first);
      clearInterval(repeat);
      logger.info({}, RETENTION_SCHEDULER_STOPPED);
    },
    tick,
  };
};
