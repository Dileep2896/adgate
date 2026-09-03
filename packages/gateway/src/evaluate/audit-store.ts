import type { AuditRecord } from '@adgate/schemas';
import { desc, eq } from 'drizzle-orm';

import type { Db, DbOrTx } from '../db/client.js';
import { apps } from '../db/tables/apps.js';
import { auditRecords, rawText } from '../db/tables/audit.js';
import { applyCapUpdates, type CapKey } from './caps.js';

/**
 * Appends one audit record to an app's chain in a single transaction:
 *   1. SELECT ... FOR UPDATE on the apps row, so two evaluations of the same app can never read
 *      the same latest record and fork the chain (appends are serialised per app);
 *   2. read the latest record (highest seq) and hand it to `build`, which chains and signs the
 *      new record against it (prev_hash = its record_hash, or genesis for the first);
 *   3. insert the audit_records row with seq = latest + 1 and is_latest true;
 *   4. count the turn in cap_state (and the served ad in user_day_caps);
 *   5. keep the conversation text in raw_text only when the policy allows it.
 * Any failure rolls all of it back and rejects; the pipeline then answers suppress/error.
 */
export interface LatestAuditRow {
  seq: number;
  record_hash: string;
}

export interface AuditPersistInput {
  appId: string;
  /** Builds the chained, signed record for the given predecessor (null = first record). */
  build: (previous: LatestAuditRow | null) => AuditRecord;
  caps: Omit<CapKey, 'appId'> & { now: Date };
  /** advertisers.id of the served creative, for the reporting column; null when none. */
  advertiserId: string | null;
  /** The prepared conversation text; null unless policy.privacy.store_raw_text is true. */
  rawText: string | null;
}

export interface PersistedAudit {
  record: AuditRecord;
  seq: number;
}

export interface AuditStore {
  persist(input: AuditPersistInput): Promise<PersistedAudit>;
}

/** The app's latest record by chain position, or null before its first. */
export const readLatestAudit = async (
  db: DbOrTx,
  appId: string,
): Promise<LatestAuditRow | null> => {
  const [row] = await db
    .select({ seq: auditRecords.seq, recordHash: auditRecords.recordHash })
    .from(auditRecords)
    .where(eq(auditRecords.appId, appId))
    .orderBy(desc(auditRecords.seq))
    .limit(1);
  return row === undefined ? null : { seq: row.seq, record_hash: row.recordHash };
};

export const createAuditStore = (db: Db): AuditStore => ({
  persist: (input) =>
    db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: apps.id })
        .from(apps)
        .where(eq(apps.id, input.appId))
        .for('update');
      if (locked === undefined) {
        throw new Error(`audit store: app ${input.appId} not found`);
      }
      const previous = await readLatestAudit(tx, input.appId);
      const record = input.build(previous);
      const seq = (previous?.seq ?? 0) + 1;
      await tx.insert(auditRecords).values({
        recordHash: record.record_hash,
        id: record.id,
        appId: input.appId,
        seq,
        prevHash: record.prev_hash,
        supersedesHash: null,
        isLatest: true,
        decision: record.decision,
        reason: record.reason,
        creativeId: record.creative?.id ?? null,
        advertiserId: input.advertiserId,
        ts: new Date(record.ts),
        record,
      });
      await applyCapUpdates(tx, {
        ...input.caps,
        appId: input.appId,
        served: record.decision === 'serve',
      });
      if (input.rawText !== null) {
        await tx
          .insert(rawText)
          .values({ auditId: record.id, appId: input.appId, text: input.rawText });
      }
      return { record, seq };
    }),
});
