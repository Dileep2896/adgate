import { isUnattested } from '@adgateio/core';
import type { AuditRecord } from '@adgateio/schemas';
import { and, eq } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { auditRecords } from '../db/tables/audit.js';
import { type LatestAuditRow, lockApp, readLatestAudit } from '../evaluate/audit-store.js';

/**
 * Persists an attestation (docs/audit.md "Rules", docs/api.md POST /v1/attest) as a SECOND
 * audit_records row with the same id, in one transaction under the same apps-row lock every
 * chain append takes (evaluate/audit-store.ts):
 *   1. lock the app, so the chain position is handed out in order;
 *   2. load the latest version of the id for THIS app (another app's id is simply not found);
 *   3. refuse a version that is already attested;
 *   4. hand the current record and the app's latest chain row to `build`, which attests and
 *      signs against them (prev_hash = the latest record_hash, supersedes_hash = the current);
 *   5. flip the current row's is_latest to false (the partial unique index allows one latest
 *      row per id), then insert the attested row at the next seq with the lookup columns
 *      copied and AttestRequest.rendered stored beside the record as attest_rendered.
 * The signed record never changes after insert; a failure rolls everything back.
 */
export type AuditRecordRow = typeof auditRecords.$inferSelect;

export interface AttestInput {
  appId: string;
  auditId: string;
  /** AttestRequest.rendered, kept on the attested row for reports (not in the signed record). */
  rendered: boolean;
  /** attest() over the current version, chained after the app's latest record. */
  build: (current: AuditRecord, latest: LatestAuditRow) => AuditRecord;
}

export type AttestOutcome =
  | { ok: true; record: AuditRecord; seq: number; supersededSeq: number }
  | { ok: false; reason: 'not_found' | 'already_attested' };

export interface AttestStore {
  attest(input: AttestInput): Promise<AttestOutcome>;
}

/** The latest version of an audit id that belongs to the app, or null. */
export const readLatestVersion = async (
  db: Db | Parameters<Parameters<Db['transaction']>[0]>[0],
  appId: string,
  auditId: string,
): Promise<AuditRecordRow | null> => {
  const [row] = await db
    .select()
    .from(auditRecords)
    .where(
      and(
        eq(auditRecords.id, auditId),
        eq(auditRecords.appId, appId),
        eq(auditRecords.isLatest, true),
      ),
    )
    .limit(1);
  return row ?? null;
};

export const createAttestStore = (db: Db): AttestStore => ({
  attest: (input) =>
    db.transaction(async (tx): Promise<AttestOutcome> => {
      await lockApp(tx, input.appId);
      const current = await readLatestVersion(tx, input.appId, input.auditId);
      if (current === null) {
        return { ok: false, reason: 'not_found' };
      }
      if (current.supersedesHash !== null || !isUnattested(current.record)) {
        return { ok: false, reason: 'already_attested' };
      }
      const latest = await readLatestAudit(tx, input.appId);
      if (latest === null) {
        // The current row is itself in the chain, so the app always has a latest record.
        throw new Error(`attest store: app ${input.appId} has a record but no chain`);
      }
      const record = input.build(current.record, latest);
      const seq = latest.seq + 1;
      await tx
        .update(auditRecords)
        .set({ isLatest: false })
        .where(eq(auditRecords.recordHash, current.recordHash));
      await tx.insert(auditRecords).values({
        recordHash: record.record_hash,
        id: current.id,
        appId: input.appId,
        seq,
        prevHash: record.prev_hash,
        supersedesHash: current.recordHash,
        isLatest: true,
        decision: current.decision,
        reason: current.reason,
        creativeId: current.creativeId,
        advertiserId: current.advertiserId,
        ts: current.ts,
        record,
        attestRendered: input.rendered,
      });
      return { ok: true, record, seq, supersededSeq: current.seq };
    }),
});
