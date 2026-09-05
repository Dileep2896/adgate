import { loadPolicyFromYaml } from '@adgate/core';

import type { Db } from '../db/client.js';
import type { Logger } from '../logger.js';
import {
  listRetentionApps,
  NO_PRUNE,
  type PruneCounts,
  prunableThroughSeq,
  pruneThroughSeq,
  type RetentionApp,
  retentionCutoff,
  writeRetentionState,
} from './queries.js';

/**
 * The retention job (docs/privacy.md, docs/policy.md `privacy.retain_days`): for every app,
 * delete the audit records older than its own retention window, plus the events and raw text
 * that belonged only to them, and record how far the deletion got so verification can still
 * explain the shortened chain.
 *
 * THREE RULES.
 *  1. Never delete under an unknown policy. An app whose stored YAML no longer parses is
 *     skipped with an error log and the run continues: the window is a promise the operator
 *     made, and a job that guessed at it could delete records it had no permission to delete.
 *  2. Delete from the oldest end only, as a seq prefix (see queries.ts). A hole in the middle
 *     of a hash chain is indistinguishable from tampering.
 *  3. Say what happened in counts, never in content. Log lines carry ids, positions and row
 *     counts; no message text, no record bodies, no policy documents.
 *
 * Pure orchestration over queries.ts, with the clock injected: `now` decides every cutoff, so a
 * test pins it rather than waiting ninety days. Never throws for one app's sake - a failure is
 * reported in that app's result and the other apps are still processed.
 */

export type RetentionStatus =
  /** Rows were deleted and the watermark was written (or would have been, on a dry run). */
  | 'pruned'
  /** The app has nothing older than its cutoff. Nothing was written. */
  | 'nothing_to_prune'
  /** The stored policy does not parse: the app was left completely alone. */
  | 'policy_unreadable'
  /** The deletion itself failed (a lock, a timeout). Rolled back; the app is untouched. */
  | 'failed';

export interface RetentionAppResult {
  app_id: string;
  status: RetentionStatus;
  /** policy.privacy.retain_days, or null when the policy could not be read. */
  retain_days: number | null;
  /** The cutoff applied, ISO 8601 UTC; null when no policy was available. */
  cutoff: string | null;
  /** The highest chain position deleted; 0 when nothing was. */
  pruned_through_seq: number;
  records_deleted: number;
  events_deleted: number;
  raw_text_deleted: number;
  /** The error class only (never a message: it could quote a row). */
  error_name?: string;
}

export interface RetentionSummary {
  /** True when nothing was committed: every deletion was rolled back. */
  dry_run: boolean;
  /** The clock the cutoffs were computed from. */
  now: string;
  apps: RetentionAppResult[];
  totals: {
    apps: number;
    pruned: number;
    skipped: number;
    failed: number;
    records_deleted: number;
    events_deleted: number;
    raw_text_deleted: number;
  };
}

export interface RetentionOptions {
  /** The clock every cutoff is measured back from. Default: this moment. */
  now?: Date | undefined;
  /** Restrict the run to one app id. Default: every app. */
  appId?: string | null | undefined;
  /** Compute and report the deletions, then roll them back. Default false. */
  dryRun?: boolean | undefined;
  logger?: Logger | undefined;
}

export const RETENTION_SKIPPED = 'retention: stored policy unreadable; app skipped';
export const RETENTION_FAILED = 'retention: app failed; nothing deleted for it';
export const RETENTION_PRUNED = 'retention: app pruned';
export const RETENTION_KEPT = 'retention: nothing older than the cutoff';

const errorName = (error: unknown): string =>
  error instanceof Error && error.name.length > 0 ? error.name : 'NonError';

/** Thrown to roll a dry run back once its counts have been collected. */
class DryRunRollback extends Error {
  override readonly name = 'RetentionDryRun';
}

const skipped = (app: RetentionApp, error: unknown): RetentionAppResult => ({
  app_id: app.id,
  status: 'policy_unreadable',
  retain_days: null,
  cutoff: null,
  pruned_through_seq: 0,
  records_deleted: 0,
  events_deleted: 0,
  raw_text_deleted: 0,
  error_name: errorName(error),
});

const counted = (
  app: RetentionApp,
  retainDays: number,
  cutoff: Date,
  throughSeq: number,
  counts: PruneCounts,
): RetentionAppResult => ({
  app_id: app.id,
  status: counts.records > 0 ? 'pruned' : 'nothing_to_prune',
  retain_days: retainDays,
  cutoff: cutoff.toISOString(),
  pruned_through_seq: counts.records > 0 ? throughSeq : 0,
  records_deleted: counts.records,
  events_deleted: counts.events,
  raw_text_deleted: counts.rawText,
});

/**
 * Deletes one app's prefix and writes its watermark in ONE transaction, so a run that fails
 * halfway leaves neither a shortened chain without a watermark nor a watermark without the
 * deletion. A dry run does exactly the same work and then throws itself out of the
 * transaction: the counts it prints are the counts a real run would produce, not an estimate.
 */
const pruneApp = async (
  db: Db,
  app: RetentionApp,
  cutoff: Date,
  now: Date,
  dryRun: boolean,
): Promise<{ throughSeq: number; counts: PruneCounts }> => {
  let collected: { throughSeq: number; counts: PruneCounts } = {
    throughSeq: 0,
    counts: NO_PRUNE,
  };
  try {
    await db.transaction(async (tx) => {
      const throughSeq = await prunableThroughSeq(tx, app.id, cutoff);
      const counts = await pruneThroughSeq(tx, app.id, throughSeq);
      if (counts.records > 0) {
        await writeRetentionState(tx, app.id, cutoff, throughSeq, now);
      }
      collected = { throughSeq, counts };
      if (dryRun) {
        throw new DryRunRollback();
      }
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) {
      throw error;
    }
  }
  return collected;
};

const runOne = async (
  db: Db,
  app: RetentionApp,
  now: Date,
  dryRun: boolean,
  logger: Logger | undefined,
): Promise<RetentionAppResult> => {
  let retainDays: number;
  try {
    retainDays = loadPolicyFromYaml(app.policyYaml).policy.privacy.retain_days;
  } catch (error) {
    const result = skipped(app, error);
    logger?.error(
      { app_id: app.id, policy_hash: app.policyHash, error_name: result.error_name },
      RETENTION_SKIPPED,
    );
    return result;
  }
  const cutoff = retentionCutoff(now, retainDays);
  try {
    const { throughSeq, counts } = await pruneApp(db, app, cutoff, now, dryRun);
    const result = counted(app, retainDays, cutoff, throughSeq, counts);
    logger?.info(
      { ...result, dry_run: dryRun },
      result.status === 'pruned' ? RETENTION_PRUNED : RETENTION_KEPT,
    );
    return result;
  } catch (error) {
    const result: RetentionAppResult = {
      app_id: app.id,
      status: 'failed',
      retain_days: retainDays,
      cutoff: cutoff.toISOString(),
      pruned_through_seq: 0,
      records_deleted: 0,
      events_deleted: 0,
      raw_text_deleted: 0,
      error_name: errorName(error),
    };
    logger?.error({ app_id: app.id, error_name: result.error_name }, RETENTION_FAILED);
    return result;
  }
};

const totalsOf = (apps: readonly RetentionAppResult[]): RetentionSummary['totals'] => ({
  apps: apps.length,
  pruned: apps.filter((app) => app.status === 'pruned').length,
  skipped: apps.filter((app) => app.status === 'policy_unreadable').length,
  failed: apps.filter((app) => app.status === 'failed').length,
  records_deleted: apps.reduce((sum, app) => sum + app.records_deleted, 0),
  events_deleted: apps.reduce((sum, app) => sum + app.events_deleted, 0),
  raw_text_deleted: apps.reduce((sum, app) => sum + app.raw_text_deleted, 0),
});

export const runRetention = async (
  db: Db,
  options: RetentionOptions = {},
): Promise<RetentionSummary> => {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const apps = await listRetentionApps(db, options.appId ?? null);
  const results: RetentionAppResult[] = [];
  for (const app of apps) {
    results.push(await runOne(db, app, now, dryRun, options.logger));
  }
  return { dry_run: dryRun, now: now.toISOString(), apps: results, totals: totalsOf(results) };
};
