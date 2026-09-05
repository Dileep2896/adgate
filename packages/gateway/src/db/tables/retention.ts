import { integer, pgTable, text } from 'drizzle-orm/pg-core';

import { apps } from './apps.js';
import { timestamptz, updatedAt } from './columns.js';

/**
 * The retention watermark of each app (docs/privacy.md, story S37). The retention job deletes
 * the OLDEST end of an app's audit chain - every row up to and including one chain position -
 * and writes here how far it got. Without that record the oldest surviving record would look
 * like a broken chain: its positional predecessor at seq - 1 is simply not there any more, and
 * verify() cannot tell "deleted on purpose, by policy" from "deleted by someone".
 *
 * TWO COLUMNS, NOT ONE, and the seq is the load-bearing one:
 *   pruned_before      the cutoff the job applied (now - policy.privacy.retain_days). The
 *                      `chain` check accepts a pruned predecessor only for a record that
 *                      post-dates it, so a record that should itself have been deleted cannot
 *                      hide behind the watermark.
 *   pruned_through_seq the highest chain position the job deleted. A missing predecessor counts
 *                      as pruned ONLY at or below this position; a hole anywhere above it is
 *                      still `previous record missing`, which is exactly what a deletion the
 *                      job did not make must look like. A timestamp alone could not make that
 *                      distinction: an attestation row copies the ts of the record it attests,
 *                      so ts order and seq order are not the same order.
 *
 * One row per app, written only by the retention job, read by audit-api/verify-context.ts.
 */
export const retentionState = pgTable('retention_state', {
  appId: text('app_id')
    .primaryKey()
    .references(() => apps.id),
  /** now - retain_days at the run that pruned; every record older than this was deleted. */
  prunedBefore: timestamptz('pruned_before').notNull(),
  /** The highest audit_records.seq deleted for this app. Positions above it were never pruned. */
  prunedThroughSeq: integer('pruned_through_seq').notNull(),
  updatedAt: updatedAt(),
});

/** A row of `retention_state` as SELECT returns it. */
export type RetentionStateRow = typeof retentionState.$inferSelect;
