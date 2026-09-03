import { AuditRecord, type VerifyCheck, type VerifyResponse } from '@adgate/schemas';

import { canonicalize } from '../canonical/canonicalize.js';
import {
  contextOf,
  isPlainObject,
  VERIFY_DETAIL,
  type VerifyContext,
  verifyCheck,
} from './verify-checks.js';

/**
 * The supersedes check (docs/audit.md: "if set, the superseded record exists and verifies"),
 * apart from verify-checks.ts because it recurses: verify.ts hands itself in as `nested`. The
 * superseded record must be present, carry supersedes_hash as its record_hash, share the id
 * and app, not be an attestation itself (attest never re-attests, so a chain of attestations is
 * forged, and this bounds the recursion to one level) and be a FAITHFUL COPY: apart from the
 * fields attestation and chaining may change, the two records must be identical, or a signed
 * attestation could quietly swap the creative or the classification. Unless
 * ctx.verifySuperseded is false it is then verified in full under nestedContext.
 */

/** What attest() and chaining may change between the two versions; nothing else may differ. */
export const ATTESTATION_FIELDS: ReadonlySet<string> = new Set([
  'model_output_hash',
  'separation_attestation',
  'attested_at',
  'supersedes_hash',
  'prev_hash',
  'key_id',
  'record_hash',
  'signature',
]);

/** Canonical JSON of the parsed record without ATTESTATION_FIELDS: what both versions share. */
export const attestedBodyOf = (record: AuditRecord): string =>
  canonicalize(
    Object.fromEntries(Object.entries(record).filter(([key]) => !ATTESTATION_FIELDS.has(key))),
  );

/**
 * The context the superseded record is verified under: ctx.superseded as given (its own
 * positional prevRecord above all), storedCreativeHash inherited from the outer context when
 * absent there, and the attesting record as supersededBy, which is what proves the separation
 * of the unattested original.
 */
export const nestedContext = (record: AuditRecord, ctx: VerifyContext): VerifyContext => {
  const nested = contextOf(ctx.superseded);
  return {
    ...nested,
    storedCreativeHash:
      nested.storedCreativeHash === undefined ? ctx.storedCreativeHash : nested.storedCreativeHash,
    supersededBy: record,
  };
};

export type NestedVerify = (record: unknown, ctx: VerifyContext) => VerifyResponse;

export const checkSupersedes = (
  record: AuditRecord,
  ctx: VerifyContext,
  nested: NestedVerify,
): VerifyCheck => {
  if (record.supersedes_hash === null) {
    return verifyCheck('supersedes', true, VERIFY_DETAIL.not_applicable);
  }
  const superseded: unknown = ctx.supersededRecord;
  if (!isPlainObject(superseded)) {
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
  const parsed = AuditRecord.safeParse(superseded);
  if (!parsed.success) {
    return verifyCheck('supersedes', false, `${VERIFY_DETAIL.superseded_invalid}: schema`);
  }
  if (attestedBodyOf(parsed.data) !== attestedBodyOf(record)) {
    return verifyCheck('supersedes', false, VERIFY_DETAIL.body_mismatch);
  }
  if (ctx.verifySuperseded === false) {
    return verifyCheck('supersedes', true, VERIFY_DETAIL.superseded_not_verified);
  }
  const result = nested(superseded, nestedContext(record, ctx));
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
