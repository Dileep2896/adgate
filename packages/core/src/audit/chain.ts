import type { AuditRecord, PrevHash, Sha256Hash, UnsignedAuditRecord } from '@adgateio/schemas';

import { canonicalize } from '../canonical/canonicalize.js';
import { sha256Prefixed, sign } from './crypto.js';
import { AuditKeyError } from './errors.js';
import { isKeyId } from './keys.js';

/**
 * The hash chain and signature of audit records (docs/audit.md "Rules"):
 *
 * - record_hash = sha256(canonical JSON of the record with record_hash and signature removed,
 *   concatenated with prev_hash). Implemented literally: prev_hash is a field of the record and
 *   so already inside the canonical JSON, and it is appended once more after it. The record is
 *   hashed as given, minus the two fields, so a field added after signing changes the hash.
 * - prev_hash is the record_hash of the previous record for the same app_id, or `genesis`.
 * - signature = Ed25519 over the record_hash string (S13's signing rule), by key_id.
 *
 * Pure: the caller supplies prev_hash (the gateway reads the app's latest record) and the
 * signing key as PEM, validated at boot with loadPrivateKey.
 */

/** prev_hash of the first record of an app. */
export const GENESIS = 'genesis' satisfies PrevHash;

export interface AuditSigningKey {
  /** Written into the record as key_id; the verifier picks the public key by it. */
  key_id: string;
  /** PKCS#8 PEM of the Ed25519 private key (ADGATE_SIGNING_KEY_PEM). */
  private_pem: string;
}

const SIGNATURE_FIELDS: ReadonlySet<string> = new Set(['record_hash', 'signature']);

/** The record without record_hash and signature, every other field kept as given. */
export const unsignedOf = (record: UnsignedAuditRecord | AuditRecord): UnsignedAuditRecord =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !SIGNATURE_FIELDS.has(key)),
  ) as UnsignedAuditRecord;

/** The exact string record_hash digests, for cross-language verifiers. */
export const recordHashInput = (record: UnsignedAuditRecord | AuditRecord): string =>
  `${canonicalize(unsignedOf(record))}${record.prev_hash}`;

/** docs/audit.md record_hash. Throws TypeError when the record is not JSON (canonicalize). */
export const computeRecordHash = (record: UnsignedAuditRecord | AuditRecord): Sha256Hash =>
  sha256Prefixed(recordHashInput(record));

/**
 * Hashes and signs a record under `signing`. The record's key_id is set from signing.key_id
 * (attestation may re-sign under a rotated key), and any record_hash or signature already
 * present is discarded first. Throws AuditKeyError for a malformed key_id or an unusable
 * private key; validate both at boot so this never fires on the request path.
 */
export const signRecord = (
  record: UnsignedAuditRecord | AuditRecord,
  signing: AuditSigningKey,
): AuditRecord => {
  if (!isKeyId(signing.key_id)) {
    throw new AuditKeyError(
      'invalid_key_id',
      'signing key_id is not a KeyId',
      String(signing.key_id),
    );
  }
  const unsigned: UnsignedAuditRecord = { ...unsignedOf(record), key_id: signing.key_id };
  const record_hash = computeRecordHash(unsigned);
  const signature = sign(record_hash, signing.private_pem);
  return { ...unsigned, record_hash, signature };
};

/** prev_hash for the record that follows `previous`: genesis when there is none. */
export const nextPrevHash = (
  previous: Pick<AuditRecord, 'record_hash'> | null | undefined,
): PrevHash => (previous === null || previous === undefined ? GENESIS : previous.record_hash);
