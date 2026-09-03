import type { AuditRecord, CapState } from '@adgate/schemas';
import { desc, eq } from 'drizzle-orm';

import type { Db, DbOrTx } from '../db/client.js';
import { apps } from '../db/tables/apps.js';
import { auditRecords, rawText } from '../db/tables/audit.js';
import { applyCapUpdates, type CapKey, readCapSnapshot } from './caps.js';

/**
 * Appends one audit record to an app's chain in a single transaction:
 *   1. SELECT ... FOR UPDATE on the apps row, so two evaluations of the same app can never read
 *      the same latest record and fork the chain (appends are serialised per app);
 *   2. read the latest record (highest seq) and the conversation's cap state AS OF NOW (the
 *      pipeline read it before classifying; a concurrent turn may have served since), and hand
 *      both to `build`, which chains and signs the new record against them (prev_hash = the
 *      latest record_hash, or genesis; a cap that filled up flips the decision to suppress);
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
  /**
   * Builds the chained, signed record for the given predecessor (null = first record) and the
   * cap state read under the app lock, which is the one the record's decision must honour.
   */
  build: (previous: LatestAuditRow | null, capState: CapState) => AuditRecord;
  caps: Omit<CapKey, 'appId'> & { now: Date };
  /** advertisers.id of the candidate that won mediation; stored only when the record serves. */
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

/**
 * SELECT ... FOR UPDATE on the apps row: every append to the app's chain (an evaluation here,
 * an attestation in attest/store.ts) takes this lock first, inside its own transaction, so
 * chain positions are handed out one at a time per app. Throws when the app does not exist.
 */
export const lockApp = async (tx: DbOrTx, appId: string): Promise<void> => {
  const [locked] = await tx
    .select({ id: apps.id })
    .from(apps)
    .where(eq(apps.id, appId))
    .for('update');
  if (locked === undefined) {
    throw new Error(`audit store: app ${appId} not found`);
  }
};

export const createAuditStore = (db: Db): AuditStore => ({
  persist: (input) =>
    db.transaction(async (tx) => {
      await lockApp(tx, input.appId);
      const previous = await readLatestAudit(tx, input.appId);
      const { now, ...capKey } = input.caps;
      const key: CapKey = { ...capKey, appId: input.appId };
      const caps = await readCapSnapshot(tx, key);
      const record = input.build(previous, caps.state);
      const served = record.decision === 'serve';
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
        advertiserId: served ? input.advertiserId : null,
        ts: new Date(record.ts),
        record,
      });
      await applyCapUpdates(tx, { ...key, row: caps.row, served, now });
      if (input.rawText !== null) {
        await tx
          .insert(rawText)
          .values({ auditId: record.id, appId: input.appId, text: input.rawText });
      }
      return { record, seq };
    }),
});
