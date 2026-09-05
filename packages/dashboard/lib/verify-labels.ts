/**
 * What each verification check means, in one sentence an operator can act on. Straight from
 * docs/audit.md "Verification checks (in order)"; the wording explains the check, it never
 * restates the verdict (that is the check's own `detail`).
 *
 * NO IMPORTS. This module is dependency free on purpose so a client component can render a
 * check name without dragging @adgate/core - and with it zod, the policy schema and the whole
 * canonical JSON implementation - into the browser bundle (the S31 lesson).
 */

export const VERIFY_CHECK_NAMES = [
  'schema',
  'record_hash',
  'chain',
  'signature',
  'creative_hash',
  'disclosure_present',
  'separation_attested',
  'supersedes',
] as const;

export type VerifyCheckLabel = (typeof VERIFY_CHECK_NAMES)[number];

/** The number of checks docs/audit.md defines. The detail page renders all of them, always. */
export const VERIFY_CHECK_COUNT = VERIFY_CHECK_NAMES.length;

const DESCRIPTIONS: Record<VerifyCheckLabel, string> = {
  schema: 'The stored record still satisfies the AuditRecord contract.',
  record_hash: 'record_hash recomputes from the record exactly as it is stored.',
  chain: 'prev_hash matches the record before this one in the app’s chain.',
  signature: 'The Ed25519 signature over record_hash verifies under the named key.',
  creative_hash: 'content_hash matches the creative stored in the catalog.',
  disclosure_present: 'The disclosure label is non-empty and sits after the answer.',
  separation_attested: 'The caller attested that the ad rendered outside the model output.',
  supersedes: 'The superseded version exists, verifies, and is otherwise an identical copy.',
};

export const describeCheck = (name: string): string =>
  (DESCRIPTIONS as Record<string, string | undefined>)[name] ?? '';

/** A failing check must be unmistakable, not a shade of red: it is labelled in words. */
export const checkVerdict = (ok: boolean): 'OK' | 'FAILED' => (ok ? 'OK' : 'FAILED');
