import type { AuditRecord, IsoTimestamp, VerifyCheck, VerifyCheckName } from '@adgateio/schemas';

import { isAttested, isUnattested } from './attest.js';
import { computeRecordHash, GENESIS } from './chain.js';
import type { PublicKeyRing } from './keys.js';

/**
 * The individual checks of docs/audit.md "Verification checks (in order)", one function each;
 * the supersedes check, which recurses, lives in verify-supersedes.ts. verify.ts runs them in
 * order after the schema check, so every function here receives a record that already parsed as
 * AuditRecord; the raw object is passed separately where the check must see the record exactly
 * as loaded (record_hash). Every function is pure and is wrapped in guardedCheck by the caller,
 * so a throw becomes a failed check, never an exception.
 */

/** Retention (S37) deleted the positional predecessor: the record must post-date the cutoff. */
export interface PrunedPredecessor {
  pruned: true;
  /** The cutoff the retention job applied: every record with ts before it was deleted. */
  retain_cutoff: IsoTimestamp;
}

/** What verify knows about the record before this one in the app's chain. */
export type PreviousRecord = AuditRecord | PrunedPredecessor | null | undefined;

export interface VerifyContext {
  /**
   * The POSITIONAL predecessor: the app's latest record immediately before this one in chain
   * order (the gateway's audit_records.seq - 1 for the same app_id), never "the record whose
   * record_hash equals prev_hash". A record whose prev_hash points at an older record is a fork
   * and must fail. null or undefined when this is the app's first record; a PrunedPredecessor
   * when retention deleted it (ok with detail 'pruned' only if the record post-dates the cutoff).
   */
  prevRecord?: PreviousRecord;
  /** creativeContentHash over the stored creatives row of record.creative.id, if it exists. */
  storedCreativeHash?: string | null | undefined;
  /**
   * The attestation that superseded this record (its supersedes_hash === record.record_hash,
   * same id and app_id, fully attested), when the record under verification is the
   * pre-attestation version. It proves the separation of an unattested record.
   * verify-supersedes.ts sets it automatically for the nested verification of supersededRecord;
   * the gateway passes it when it verifies an older version of an id directly.
   */
  supersededBy?: AuditRecord | null | undefined;
  /** The record whose record_hash equals record.supersedes_hash, when set. */
  supersededRecord?: AuditRecord | null | undefined;
  /** false skips the recursive verification of supersededRecord (presence, identity, body). */
  verifySuperseded?: boolean | undefined;
  /**
   * The context of the recursive verification of supersededRecord: ITS OWN positional
   * prevRecord (required unless the original is the app's genesis record) and its
   * storedCreativeHash, which is inherited from this context when absent (undefined) here: the
   * body check guarantees both versions name the same creative. supersededBy is set by verify.
   */
  superseded?: VerifyContext | undefined;
}

/** Every detail string verify writes, so later stories and tests share one vocabulary. */
export const VERIFY_DETAIL = {
  skipped: 'skipped: schema invalid',
  not_applicable: 'not applicable',
  hash_mismatch: 'record_hash does not recompute from the record',
  genesis: 'genesis',
  pruned: 'pruned',
  pruned_before_cutoff: 'record predates the retention cutoff of its pruned predecessor',
  genesis_with_previous: 'genesis record given a previous record',
  previous_missing: 'previous record missing',
  previous_mismatch: 'prev_hash does not match the previous record',
  previous_other_app: 'previous record belongs to another app',
  stored_creative_missing: 'stored creative missing',
  creative_mismatch: 'content_hash does not match the stored creative',
  label_empty: 'label empty',
  not_attested: 'not attested',
  attestation_incomplete: 'attestation incomplete',
  attested_by_superseding: 'attested by superseding record',
  superseded_missing: 'superseded record missing',
  superseded_mismatch: 'supersedes_hash does not match the superseded record',
  superseded_other_id: 'superseded record has another id',
  superseded_other_app: 'superseded record belongs to another app',
  superseded_is_attestation: 'superseded record is itself an attestation',
  body_mismatch: 'body_mismatch',
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

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A context as given, or an empty one for anything that is not a plain object. */
export const contextOf = (ctx: unknown): VerifyContext =>
  isPlainObject(ctx) ? (ctx as VerifyContext) : {};

/** record_hash recomputed over the record exactly as loaded, extra keys included. */
export const checkRecordHash = (raw: unknown, record: AuditRecord): VerifyCheck =>
  computeRecordHash(raw as AuditRecord) === record.record_hash
    ? verifyCheck('record_hash', true)
    : verifyCheck('record_hash', false, VERIFY_DETAIL.hash_mismatch);

const isPruned = (previous: unknown): previous is PrunedPredecessor =>
  isPlainObject(previous) && previous['pruned'] === true;

/**
 * prev_hash against the POSITIONAL predecessor (see VerifyContext.prevRecord): genesis is ok
 * only when there is none; a pruned predecessor is ok only for a record the retention cutoff
 * kept; otherwise the predecessor must exist, carry prev_hash as its record_hash and belong to
 * the same app.
 */
export const checkChain = (record: AuditRecord, previous: unknown): VerifyCheck => {
  if (record.prev_hash === GENESIS) {
    return previous === null || previous === undefined
      ? verifyCheck('chain', true, VERIFY_DETAIL.genesis)
      : verifyCheck('chain', false, VERIFY_DETAIL.genesis_with_previous);
  }
  if (isPruned(previous)) {
    const cutoff = Date.parse(String(previous.retain_cutoff));
    return Number.isFinite(cutoff) && Date.parse(record.ts) >= cutoff
      ? verifyCheck('chain', true, VERIFY_DETAIL.pruned)
      : verifyCheck('chain', false, VERIFY_DETAIL.pruned_before_cutoff);
  }
  if (!isPlainObject(previous)) {
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
 * True when `by` is the attestation of `record`: it supersedes exactly this record (same id and
 * app_id) and carries a complete attestation. Anything else, a partial attestation included,
 * proves nothing.
 */
export const attestsRecord = (record: AuditRecord, by: unknown): boolean => {
  if (!isPlainObject(by)) {
    return false;
  }
  const next = by as Partial<AuditRecord>;
  return (
    next.supersedes_hash === record.record_hash &&
    next.id === record.id &&
    next.app_id === record.app_id &&
    next.separation_attestation === true &&
    typeof next.model_output_hash === 'string' &&
    typeof next.attested_at === 'string'
  );
};

/**
 * True only if attested. An unattested record whose superseding attestation is handed in
 * (ctx.supersededBy) is proven by that record; an unattested suppress record has nothing to
 * attest (not applicable); an unattested serve record is simply not attested. Any partial
 * attestation fails.
 */
export const checkSeparation = (record: AuditRecord, supersededBy: unknown): VerifyCheck => {
  if (isAttested(record)) {
    return verifyCheck('separation_attested', true);
  }
  if (!isUnattested(record)) {
    return verifyCheck('separation_attested', false, VERIFY_DETAIL.attestation_incomplete);
  }
  if (attestsRecord(record, supersededBy)) {
    return verifyCheck('separation_attested', true, VERIFY_DETAIL.attested_by_superseding);
  }
  if (record.decision === 'suppress') {
    return verifyCheck('separation_attested', true, VERIFY_DETAIL.not_applicable);
  }
  return verifyCheck('separation_attested', false, VERIFY_DETAIL.not_attested);
};
