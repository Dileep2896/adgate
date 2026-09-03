import {
  AuditRecord,
  IsoTimestamp,
  PrevHash,
  Sha256Hash,
  type UnsignedAuditRecord,
} from '@adgate/schemas';

import { type AuditSigningKey, GENESIS, signRecord, unsignedOf } from './chain.js';
import { describeIssues } from './errors.js';

/**
 * Attestation (docs/audit.md "Rules", docs/api.md POST /v1/attest): after the model's answer is
 * complete the SDK reports the hash of that output, and the gateway produces a NEW record that
 * copies the original, sets model_output_hash, separation_attestation true, attested_at and
 * supersedes_hash = the original record_hash, then re-hashes and re-signs it. Both records stay
 * in the app's chain and both verify: the original is never rewritten.
 *
 * Chain position: the attested record keeps the original's `id` (the audit_id the SDK holds and
 * GET /v1/audit/:id serves) and takes its own prev_hash, the app's latest record_hash at
 * attestation time, which the caller supplies because core is pure. The gateway stores both
 * rows keyed by record_hash and marks the newest version per id.
 */

export type AuditAttestErrorReason =
  | 'invalid_record'
  | 'already_attested'
  | 'invalid_model_output_hash'
  | 'invalid_attested_at'
  | 'invalid_prev_hash';

/**
 * Thrown by attest for an input the contract rejects. Request-time, unlike AuditKeyError: the
 * gateway maps it to a 4xx (already_attested is a conflict, the rest are bad requests). The
 * message names the record id at most, never record content.
 */
export class AuditAttestError extends Error {
  override readonly name = 'AuditAttestError';
  readonly reason: AuditAttestErrorReason;

  constructor(reason: AuditAttestErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface AttestOptions {
  /** nextPrevHash(the app's latest record) at attestation time. Never genesis. */
  prev_hash: PrevHash;
  /** The current signing key; a rotated key_id is fine, the ring keeps the old public key. */
  signing: AuditSigningKey;
}

type AttestationFields = Pick<
  AuditRecord,
  'model_output_hash' | 'separation_attestation' | 'attested_at' | 'supersedes_hash'
>;

/** True when every attestation field is set: what the separation_attested check accepts. */
export const isAttested = (record: AttestationFields): boolean =>
  record.separation_attestation === true &&
  record.model_output_hash !== null &&
  record.attested_at !== null;

/** True when no attestation field is set: a record as buildAuditRecord writes it. */
export const isUnattested = (record: AttestationFields): boolean =>
  record.separation_attestation === false &&
  record.model_output_hash === null &&
  record.attested_at === null &&
  record.supersedes_hash === null;

/**
 * Builds the attested version of `record`. The copy is taken from the validated parse, so the
 * new record is exactly the AuditRecord shape (unknown keys dropped, override_rejected present)
 * and shares nothing with the input. Throws AuditAttestError for an invalid record, a record
 * with any attestation field already set, a malformed model_output_hash, attested_at or
 * prev_hash; AuditKeyError for an unusable signing key (a config error, validate at boot).
 */
export const attest = (
  record: AuditRecord,
  model_output_hash: Sha256Hash,
  now: IsoTimestamp,
  opts: AttestOptions,
): AuditRecord => {
  const parsed = AuditRecord.safeParse(record);
  if (!parsed.success) {
    throw new AuditAttestError(
      'invalid_record',
      `record is not an AuditRecord:\n${describeIssues(parsed.error.issues)}`,
    );
  }
  const original = parsed.data;
  if (!isUnattested(original)) {
    throw new AuditAttestError('already_attested', `record ${original.id} is already attested`);
  }
  if (!Sha256Hash.safeParse(model_output_hash).success) {
    throw new AuditAttestError(
      'invalid_model_output_hash',
      'model_output_hash must be written as sha256:<hex>',
    );
  }
  if (!IsoTimestamp.safeParse(now).success) {
    throw new AuditAttestError(
      'invalid_attested_at',
      'attested_at must be an ISO 8601 UTC timestamp',
    );
  }
  const prevHash = PrevHash.safeParse(opts?.prev_hash);
  if (!prevHash.success || prevHash.data === GENESIS) {
    throw new AuditAttestError(
      'invalid_prev_hash',
      'prev_hash must be the record_hash of the latest record of the app (an attestation is never the first record)',
    );
  }
  const unsigned: UnsignedAuditRecord = {
    ...unsignedOf(original),
    model_output_hash,
    separation_attestation: true,
    attested_at: now,
    supersedes_hash: original.record_hash,
    prev_hash: prevHash.data,
  };
  return signRecord(unsigned, opts.signing);
};
