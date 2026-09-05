import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { Db, DbOrTx } from '../db/client.js';
import { apps } from '../db/tables/apps.js';
import { auditRecords, events, rawText } from '../db/tables/audit.js';
import { retentionState, type RetentionStateRow } from '../db/tables/retention.js';

/**
 * The reads and writes of the retention job (docs/privacy.md). Nothing here decides policy: the
 * caller supplies the cutoff, this module finds the chain position that cutoff reaches and
 * deletes up to it.
 *
 * WHY A SEQ PREFIX AND NOT A ts PREDICATE. audit_records.seq is the record's position in its
 * app's hash chain, and verify() checks a record against the row at seq - 1. `delete where
 * ts < cutoff` would be free to punch a hole anywhere in that chain, and every record after
 * such a hole would fail `previous record missing` forever - the audit log would be unusable
 * exactly where it still exists. Deleting a PREFIX (`seq <= n`) can only ever shorten the chain
 * from the oldest end: at most one surviving record has a missing predecessor, and the
 * retention watermark explains that one. It is also the index-friendly form
 * (audit_records_app_id_seq_uidx) and states the invariant in the query itself.
 *
 * The prefix is bounded by the FIRST row at or after the cutoff, not by the last row before it.
 * The two are not the same position: an attestation copies the ts of the record it attests onto
 * a row at the top of the chain (attest/store.ts), so a row can be older in ts than a row below
 * it in seq. Taking the highest seq with an old ts would then delete records the cutoff says to
 * keep. The first row that must be kept pins everything under it, which over-retains a little
 * and can never over-delete - the only direction a retention job may err in.
 */

export const DAY_MS = 86_400_000;

/** The cutoff for a policy's retain_days: records older than this may be deleted. */
export const retentionCutoff = (now: Date, retainDays: number): Date =>
  new Date(now.getTime() - retainDays * DAY_MS);

/** An app as the job needs it: its id and the policy document that says how long to keep. */
export interface RetentionApp {
  id: string;
  policyYaml: string;
  policyHash: string;
}

export const listRetentionApps = (db: Db, appId?: string | null): Promise<RetentionApp[]> => {
  const columns = { id: apps.id, policyYaml: apps.policyYaml, policyHash: apps.policyHash };
  const query = db.select(columns).from(apps);
  return (appId === undefined || appId === null ? query : query.where(eq(apps.id, appId))).orderBy(
    asc(apps.id),
  );
};

/**
 * The last chain position of the app whose whole prefix predates `cutoff`, or 0 when the app's
 * first surviving record is already at or after it. Every row with seq <= this result has
 * ts < cutoff; the row above it (when there is one) is the oldest record retention must keep.
 */
export const prunableThroughSeq = async (
  db: DbOrTx,
  appId: string,
  cutoff: Date,
): Promise<number> => {
  const [keep] = await db
    .select({ seq: auditRecords.seq })
    .from(auditRecords)
    .where(and(eq(auditRecords.appId, appId), gte(auditRecords.ts, cutoff)))
    .orderBy(asc(auditRecords.seq))
    .limit(1);
  if (keep !== undefined) {
    return keep.seq - 1;
  }
  const [last] = await db
    .select({ seq: auditRecords.seq })
    .from(auditRecords)
    .where(eq(auditRecords.appId, appId))
    .orderBy(desc(auditRecords.seq))
    .limit(1);
  return last?.seq ?? 0;
};

export interface PruneCounts {
  records: number;
  events: number;
  rawText: number;
}

export const NO_PRUNE: PruneCounts = { records: 0, events: 0, rawText: 0 };

/**
 * Deletes every row of the app at or below `throughSeq`, then the events and raw_text of the
 * audit ids that lost their LAST audit_records row. An id can have two rows (the original and
 * its attestation, S19), and the attestation may sit above the prefix: while any row of the id
 * survives, the turn is still in the log and its events and text belong to it.
 */
export const pruneThroughSeq = async (
  tx: DbOrTx,
  appId: string,
  throughSeq: number,
): Promise<PruneCounts> => {
  if (throughSeq < 1) {
    return NO_PRUNE;
  }
  const deleted = await tx
    .delete(auditRecords)
    .where(and(eq(auditRecords.appId, appId), lte(auditRecords.seq, throughSeq)))
    .returning({ id: auditRecords.id });
  const touched = [...new Set(deleted.map((row) => row.id))];
  const orphans = await orphanAuditIds(tx, appId, touched);
  if (orphans.length === 0) {
    return { records: deleted.length, events: 0, rawText: 0 };
  }
  const removedEvents = await tx
    .delete(events)
    .where(and(eq(events.appId, appId), inArray(events.auditId, orphans)))
    .returning({ id: events.id });
  const removedText = await tx
    .delete(rawText)
    .where(and(eq(rawText.appId, appId), inArray(rawText.auditId, orphans)))
    .returning({ auditId: rawText.auditId });
  return { records: deleted.length, events: removedEvents.length, rawText: removedText.length };
};

/** Of the given audit ids, the ones with no audit_records row left for this app. */
const orphanAuditIds = async (
  tx: DbOrTx,
  appId: string,
  auditIds: readonly string[],
): Promise<string[]> => {
  if (auditIds.length === 0) {
    return [];
  }
  const surviving = await tx
    .selectDistinct({ id: auditRecords.id })
    .from(auditRecords)
    .where(and(eq(auditRecords.appId, appId), inArray(auditRecords.id, [...auditIds])));
  const kept = new Set(surviving.map((row) => row.id));
  return auditIds.filter((id) => !kept.has(id));
};

/** The retention watermark of an app, or null when the job has never pruned it. */
export const readRetentionState = async (
  db: DbOrTx,
  appId: string,
): Promise<RetentionStateRow | null> => {
  const [row] = await db
    .select()
    .from(retentionState)
    .where(eq(retentionState.appId, appId))
    .limit(1);
  return row ?? null;
};

/**
 * Records how far retention got. Both columns move forward only (`greatest`): a run under a
 * longer retain_days deletes nothing new and must not weaken what an earlier run recorded, and
 * a watermark that went backwards would turn an already explained gap back into a broken chain.
 */
export const writeRetentionState = async (
  tx: DbOrTx,
  appId: string,
  prunedBefore: Date,
  prunedThroughSeq: number,
  now: Date,
): Promise<void> => {
  await tx
    .insert(retentionState)
    .values({ appId, prunedBefore, prunedThroughSeq, updatedAt: now })
    .onConflictDoUpdate({
      target: retentionState.appId,
      set: {
        // The casts are not decoration: greatest() over an untyped parameter is ambiguous.
        prunedBefore: sql`greatest(${retentionState.prunedBefore}, ${prunedBefore.toISOString()}::timestamptz)`,
        prunedThroughSeq: sql`greatest(${retentionState.prunedThroughSeq}, ${prunedThroughSeq}::integer)`,
        updatedAt: now,
      },
    });
};
