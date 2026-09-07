import type { PreviousRecord, VerifyContext } from '@adgateio/core';

import type { AuditRecordRow } from '../attest/store.js';
import type { AuditReader } from './loader.js';

/**
 * The VerifyContext (core verify, S15/REVIEW-2) for one stored version, built from the rows
 * around it:
 *   prevRecord        the POSITIONAL predecessor, the app's row at seq - 1 (null at seq 1 or when
 *                     that row is gone, so a non-genesis record then fails 'previous record
 *                     missing' and a genesis record in mid-chain fails against the row that is
 *                     there; { pruned: true, retain_cutoff } when the retention job deleted it,
 *                     which verifies as `chain` ok with detail 'pruned');
 *   storedCreativeHash creativeContentHash of the creatives row the record names (null when the
 *                     row is gone, so creative_hash fails 'stored creative missing');
 *   supersededRecord  the row whose record_hash is the record's supersedes_hash, with its own
 *                     positional predecessor under `superseded` (creative hash inherited);
 *   supersededBy      when the version asked for is not the latest one of its id, the latest row
 *                     if it is the attestation of this one, which proves the separation of the
 *                     older version.
 * Reads the signed JSON for the creative id and supersedes_hash (the columns are copies); a
 * record that is not even an object gets an empty context and fails the schema check anyway.
 */
const field = (record: unknown, key: string): unknown =>
  record !== null && typeof record === 'object' && !Array.isArray(record)
    ? (record as Record<string, unknown>)[key]
    : undefined;

const stringField = (record: unknown, key: string): string | null => {
  const value = field(record, key);
  return typeof value === 'string' ? value : null;
};

export const creativeIdOf = (record: unknown): string | null =>
  stringField(field(record, 'creative'), 'id');

export const supersedesHashOf = (record: unknown): string | null =>
  stringField(record, 'supersedes_hash');

/**
 * The record at seq - 1 of the same app; null when there is none.
 *
 * A predecessor that is not there is only sometimes innocent. The retention job (S37) deletes a
 * PREFIX of the chain and records how far it got in retention_state, so a gap at or below that
 * position is the policy working as documented and this returns the pruned marker core's
 * `chain` check accepts (it still requires the record itself to post-date the cutoff). A gap
 * ABOVE the watermark, or in an app the job has never touched, stays null and fails
 * 'previous record missing' - which is the whole point of keeping the two apart.
 *
 * The extra read happens only when the row is actually missing, so an intact chain pays nothing.
 */
const predecessorOf = async (reader: AuditReader, row: AuditRecordRow): Promise<PreviousRecord> => {
  if (row.seq <= 1) {
    return null;
  }
  const previousSeq = row.seq - 1;
  const previous = await reader.findBySeq(row.appId, previousSeq);
  if (previous !== null) {
    return previous.record;
  }
  const watermark = await reader.retentionWatermark(row.appId);
  if (watermark === null || previousSeq > watermark.prunedThroughSeq) {
    return null;
  }
  return { pruned: true, retain_cutoff: watermark.prunedBefore.toISOString() };
};

export const buildVerifyContext = async (
  reader: AuditReader,
  row: AuditRecordRow,
): Promise<VerifyContext> => {
  const ctx: VerifyContext = { prevRecord: await predecessorOf(reader, row) };

  const creativeId = creativeIdOf(row.record);
  if (creativeId !== null) {
    ctx.storedCreativeHash = await reader.creativeHash(creativeId);
  }

  const supersedesHash = supersedesHashOf(row.record);
  if (supersedesHash !== null) {
    const superseded = await reader.findByHash(supersedesHash);
    ctx.supersededRecord = superseded?.record ?? null;
    if (superseded !== null) {
      ctx.superseded = { prevRecord: await predecessorOf(reader, superseded) };
    }
  }

  if (!row.isLatest) {
    const latest = await reader.findLatest(row.id);
    if (latest !== null && latest.supersedesHash === row.recordHash) {
      ctx.supersededBy = latest.record;
    }
  }
  return ctx;
};
