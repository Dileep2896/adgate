import {
  AuditRecord,
  type VerifyCheck,
  VerifyCheckName,
  type VerifyResponse,
} from '@adgateio/schemas';

import type { PublicKeyRing } from './keys.js';
import {
  checkChain,
  checkCreativeHash,
  checkDisclosure,
  checkRecordHash,
  checkSeparation,
  checkSignature,
  contextOf,
  errorName,
  guardedCheck,
  VERIFY_DETAIL,
  type VerifyContext,
  verifyCheck,
} from './verify-checks.js';
import { checkSupersedes, type NestedVerify } from './verify-supersedes.js';

export { VERIFY_DETAIL } from './verify-checks.js';
export type { PreviousRecord, PrunedPredecessor, VerifyContext } from './verify-checks.js';

/**
 * verify (docs/audit.md "Verification checks (in order)", docs/api.md GET /v1/verify/:id): runs
 * the eight checks in the documented order over a record as loaded and reports
 * { valid, checks }. valid is true only when every check is ok.
 *
 * Never throws, for any input: a value that is not an AuditRecord fails `schema` and every later
 * check is reported as skipped; a check that throws (a value canonical JSON rejects, a broken
 * key ring) is reported as failed with the error name. Pure: the positional previous record,
 * the stored creative hash, the superseding attestation and the superseded record are handed in
 * through ctx by the gateway (see VerifyContext), and the public keys come as an S13
 * PublicKeyRing built at boot.
 */

/** The eight checks in order, straight from the contract schema. */
export const VERIFY_CHECK_ORDER: readonly VerifyCheckName[] = VerifyCheckName.options;

const MAX_DETAIL_LENGTH = 200;

/** `path: message` for the first issues, values never echoed (zod messages name types only). */
const summarizeIssues = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string => {
  const summary = issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return summary.length > MAX_DETAIL_LENGTH ? `${summary.slice(0, MAX_DETAIL_LENGTH)}...` : summary;
};

type ParsedRecord = { ok: true; record: AuditRecord } | { ok: false; detail: string };

const parseRecord = (record: unknown): ParsedRecord => {
  try {
    const result = AuditRecord.safeParse(record);
    return result.success
      ? { ok: true, record: result.data }
      : { ok: false, detail: summarizeIssues(result.error.issues) };
  } catch (error) {
    return { ok: false, detail: `error: ${errorName(error)}` };
  }
};

const failedResponse = (detail: string, first?: VerifyCheck): VerifyResponse => ({
  valid: false,
  checks: VERIFY_CHECK_ORDER.map((name, index) =>
    index === 0 && first !== undefined ? first : verifyCheck(name, false, detail),
  ),
});

const verifyWith = (record: unknown, ring: PublicKeyRing, rawCtx: unknown): VerifyResponse => {
  const ctx = contextOf(rawCtx);
  const parsed = parseRecord(record);
  if (!parsed.ok) {
    return failedResponse(VERIFY_DETAIL.skipped, verifyCheck('schema', false, parsed.detail));
  }
  const rec = parsed.record;
  const nested: NestedVerify = (superseded, nestedCtx) => verifyWith(superseded, ring, nestedCtx);
  const checks: VerifyCheck[] = [
    verifyCheck('schema', true),
    guardedCheck('record_hash', () => checkRecordHash(record, rec)),
    guardedCheck('chain', () => checkChain(rec, ctx.prevRecord)),
    guardedCheck('signature', () => checkSignature(rec, ring)),
    guardedCheck('creative_hash', () => checkCreativeHash(rec, ctx.storedCreativeHash)),
    guardedCheck('disclosure_present', () => checkDisclosure(rec)),
    guardedCheck('separation_attested', () => checkSeparation(rec, ctx.supersededBy)),
    guardedCheck('supersedes', () => checkSupersedes(rec, ctx, nested)),
  ];
  return { valid: checks.every((check) => check.ok), checks };
};

/**
 * Verifies `record` (any value: the object as loaded from storage) with the public keys in
 * `keyRing` and the neighbouring records in `ctx`. See VerifyContext for what to pass.
 */
export const verify = (
  record: unknown,
  keyRing: PublicKeyRing,
  ctx: VerifyContext = {},
): VerifyResponse => {
  try {
    return verifyWith(record, keyRing, ctx);
  } catch (error) {
    return failedResponse(`error: ${errorName(error)}`);
  }
};
