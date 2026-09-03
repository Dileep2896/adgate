import type { AuditRecord, VerifyCheck, VerifyCheckName, VerifyResponse } from '@adgate/schemas';

import { isAttested, isUnattested } from './attest.js';
import { computeRecordHash, GENESIS } from './chain.js';
import type { PublicKeyRing } from './keys.js';

/**
 * The individual checks of docs/audit.md "Verification checks (in order)", one function each.
 * verify.ts runs them in order after the schema check, so every function here receives a
 * record that already parsed as AuditRecord; the raw object is passed separately where the
 * check must see the record exactly as loaded (record_hash). Every function is pure and is
 * wrapped in guardedCheck by the caller, so a throw becomes a failed check, never an exception.
 */

/** What verify knows about the record before this one in the app's chain. */
export type PreviousRecord = AuditRecord | null | undefined | 'pruned';

export interface VerifyContext {
  /**
   * The record whose record_hash equals record.prev_hash, null or undefined when prev_hash is
   * genesis, or the literal 'pruned' when retention deleted the predecessor (reported as ok
   * with detail 'pruned').
   */
  prevRecord?: PreviousRecord;
  /** creativeContentHash over the stored creatives row of record.creative.id, if it exists. */
  storedCreativeHash?: string | null | undefined;
  /** The record whose record_hash equals record.supersedes_hash, when set. */
  supersededRecord?: AuditRecord | null | undefined;
  /** false skips the recursive verification of supersededRecord (presence and identity only). */
  verifySuperseded?: boolean | undefined;
  /** The context of the recursive verification of supersededRecord (its own prev record etc.). */
  superseded?: VerifyContext | undefined;
}

/** How the record under verification was reached: the newest version, or via supersedes_hash. */
export type VerifyRole = 'latest' | 'superseded';

/** Every detail string verify writes, so later stories and tests share one vocabulary. */
export const VERIFY_DETAIL = {
  skipped: 'skipped: schema invalid',
  not_applicable: 'not applicable',
  hash_mismatch: 'record_hash does not recompute from the record',
  genesis: 'genesis',
  pruned: 'pruned',
  genesis_with_previous: 'genesis record given a previous record',
  previous_missing: 'previous record missing',
  previous_mismatch: 'prev_hash does not match the previous record',
  previous_other_app: 'previous record belongs to another app',
  stored_creative_missing: 'stored creative missing',
  creative_mismatch: 'content_hash does not match the stored creative',
  label_empty: 'label empty',
  not_attested: 'not attested',
  attestation_incomplete: 'attestation incomplete',
  superseded: 'superseded',
  superseded_missing: 'superseded record missing',
  superseded_mismatch: 'supersedes_hash does not match the superseded record',
  superseded_other_id: 'superseded record has another id',
  superseded_other_app: 'superseded record belongs to another app',
  superseded_is_attestation: 'superseded record is itself an attestation',
  superseded_not_verified: 'superseded record present, not verified',
  superseded_verified: 'superseded record verified',
  superseded_invalid: 'superseded record invalid',
} as const;

/** A VerifyCheck without a detail key when there is no detail (exactOptionalPropertyTypes). */
export const verifyCheck = (name: VerifyCheckName, ok: boolean, detail?: string): VerifyCheck =>
  detail === undefined ? { name, ok } : { name, ok, detail };

export const errorName = (error: unknown): string =>
  error instanceof Error && error.name.length > 0 ? error.name : 'NonError';

/** Runs one check; a throw is reported as a failed check naming the error class only. */
export const guardedCheck = (name: VerifyCheckName, run: () => VerifyCheck): VerifyCheck => {
  try {
    return run();
  } catch (error) {
    return verifyCheck(name, false, `error: ${errorName(error)}`);
  }
};

/** record_hash recomputed over the record exactly as loaded, extra keys included. */
export const checkRecordHash = (raw: unknown, record: AuditRecord): VerifyCheck =>
  computeRecordHash(raw as AuditRecord) === record.record_hash
    ? verifyCheck('record_hash', true)
    : verifyCheck('record_hash', false, VERIFY_DETAIL.hash_mismatch);

export const checkChain = (record: AuditRecord, previous: unknown): VerifyCheck => {
  if (record.prev_hash === GENESIS) {
    return previous === null || previous === undefined
      ? verifyCheck('chain', true, VERIFY_DETAIL.genesis)
      : verifyCheck('chain', false, VERIFY_DETAIL.genesis_with_previous);
  }
  if (previous === 'pruned') {
    return verifyCheck('chain', true, VERIFY_DETAIL.pruned);
  }
  if (previous === null || typeof previous !== 'object') {
    return verifyCheck('chain', false, VERIFY_DETAIL.previous_missing);
  }
  const prev = previous as Partial<AuditRecord>;
  if (prev.record_hash !== record.prev_hash) {
    return verifyCheck('chain', false, VERIFY_DETAIL.previous_mismatch);
  }
  if (prev.app_id !== record.app_id) {
    return verifyCheck('chain', false, VERIFY_DETAIL.previous_other_app);
  }
  return verifyCheck('chain', true);
};

export const checkSignature = (record: AuditRecord, ring: PublicKeyRing): VerifyCheck => {
  const result = ring.verify(record.record_hash, record.signature, record.key_id);
  const detail: string | undefined = typeof result.detail === 'string' ? result.detail : undefined;
  return verifyCheck('signature', result.ok === true, detail);
};

export const checkCreativeHash = (record: AuditRecord, stored: unknown): VerifyCheck => {
  if (record.creative === null) {
    return verifyCheck('creative_hash', true, VERIFY_DETAIL.not_applicable);
  }
  if (typeof stored !== 'string' || stored.length === 0) {
    return verifyCheck('creative_hash', false, VERIFY_DETAIL.stored_creative_missing);
  }
  return stored === record.creative.content_hash
    ? verifyCheck('creative_hash', true)
    : verifyCheck('creative_hash', false, VERIFY_DETAIL.creative_mismatch);
};

/** Label non-empty (whitespace does not count), position after_answer, style separate_block. */
export const checkDisclosure = (record: AuditRecord): VerifyCheck => {
  const { label, position, style } = record.disclosure;
  if (typeof label !== 'string' || label.trim().length === 0) {
    return verifyCheck('disclosure_present', false, VERIFY_DETAIL.label_empty);
  }
  if (position !== 'after_answer') {
    return verifyCheck('disclosure_present', false, `position=${String(position)}`);
  }
  if (style !== 'separate_block') {
    return verifyCheck('disclosure_present', false, `style=${String(style)}`);
  }
  return verifyCheck('disclosure_present', true);
};

/**
 * True only if attested. An unattested suppress record has nothing to attest (not applicable);
 * an unattested record reached through supersedes_hash is the pre-attestation version whose
 * separation the superseding record proves (superseded); an unattested serve record at the head
 * of its history is simply not attested. Any partial attestation fails.
 */
export const checkSeparation = (record: AuditRecord, role: VerifyRole): VerifyCheck => {
  if (isAttested(record)) {
    return verifyCheck('separation_attested', true);
  }
  if (!isUnattested(record)) {
    return verifyCheck('separation_attested', false, VERIFY_DETAIL.attestation_incomplete);
  }
  if (record.decision === 'suppress') {
    return verifyCheck('separation_attested', true, VERIFY_DETAIL.not_applicable);
  }
  if (role === 'superseded') {
    return verifyCheck('separation_attested', true, VERIFY_DETAIL.superseded);
  }
  return verifyCheck('separation_attested', false, VERIFY_DETAIL.not_attested);
};

export type NestedVerify = (record: unknown, ctx: VerifyContext | undefined) => VerifyResponse;

/**
 * If supersedes_hash is set, the superseded record must be present, carry that hash, share the
 * id and app, not be an attestation itself (attest never re-attests, so a chain of attestations
 * is forged) and, unless ctx.verifySuperseded is false, verify in full under ctx.superseded.
 */
export const checkSupersedes = (
  record: AuditRecord,
  ctx: VerifyContext,
  nested: NestedVerify,
): VerifyCheck => {
  if (record.supersedes_hash === null) {
    return verifyCheck('supersedes', true, VERIFY_DETAIL.not_applicable);
  }
  const superseded: unknown = ctx.supersededRecord;
  if (superseded === null || superseded === undefined || typeof superseded !== 'object') {
    return verifyCheck('supersedes', false, VERIFY_DETAIL.superseded_missing);
  }
  const prior = superseded as Partial<AuditRecord>;
  if (prior.record_hash !== record.supersedes_hash) {
    return verifyCheck('supersedes', false, VERIFY_DETAIL.superseded_mismatch);
  }
  if (prior.id !== record.id) {
    return verifyCheck('supersedes', false, VERIFY_DETAIL.superseded_other_id);
  }
  if (prior.app_id !== record.app_id) {
    return verifyCheck('supersedes', false, VERIFY_DETAIL.superseded_other_app);
  }
  if (typeof prior.supersedes_hash === 'string') {
    return verifyCheck('supersedes', false, VERIFY_DETAIL.superseded_is_attestation);
  }
  if (ctx.verifySuperseded === false) {
    return verifyCheck('supersedes', true, VERIFY_DETAIL.superseded_not_verified);
  }
  const result = nested(superseded, ctx.superseded);
  if (result.valid) {
    return verifyCheck('supersedes', true, VERIFY_DETAIL.superseded_verified);
  }
  const failed = result.checks.filter((check) => !check.ok).map((check) => check.name);
  return verifyCheck(
    'supersedes',
    false,
    `${VERIFY_DETAIL.superseded_invalid}: ${failed.join(',')}`,
  );
};
