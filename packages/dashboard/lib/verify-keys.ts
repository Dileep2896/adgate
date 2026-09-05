import {
  createKeyRing,
  derivePublicPem,
  parsePublicKeysJson,
  type PublicKeyRing,
} from '@adgate/core';

import { loadRepoEnvFile } from './env';

/**
 * The public keys /audit verifies signatures against.
 *
 * The dashboard needs PUBLIC key material only: ADGATE_PUBLIC_KEYS_JSON, the same key_id ->
 * SPKI PEM map the gateway loads at boot, retired keys included. A development machine usually
 * has that as `{}` and the real key only in ADGATE_SIGNING_KEY_PEM, so when the private key is
 * present its public half is derived and added under ADGATE_SIGNING_KEY_ID exactly as
 * packages/gateway/src/signing.ts does - the private key itself is used for nothing here and is
 * never held, logged or rendered.
 *
 * NEVER THROWS. A dashboard that cannot parse its keys must still render the audit log with an
 * honest "signatures cannot be checked" banner and every other verification check intact; it
 * must not 500, and it must never report a record as valid when it could not check the
 * signature (an empty ring fails the `signature` check with unknown_key_id, which is exactly
 * the truthful answer). `issue` says what is wrong, naming variables and never key material.
 */

export interface VerifyKeys {
  ring: PublicKeyRing;
  /** Human-readable reason the ring is empty or incomplete, or null when it is fine. */
  issue: string | null;
}

const NO_KEYS =
  'no verification keys are configured: set ADGATE_PUBLIC_KEYS_JSON (or ADGATE_SIGNING_KEY_PEM) so signatures can be checked';

const reason = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : 'unusable';

const blank = (value: string | undefined): boolean => value === undefined || value.trim() === '';

export const loadVerifyKeys = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): VerifyKeys => {
  const issues: string[] = [];
  let keys: Record<string, string> = {};

  const json = env['ADGATE_PUBLIC_KEYS_JSON'];
  if (!blank(json)) {
    try {
      keys = { ...parsePublicKeysJson(json as string) };
    } catch (error) {
      issues.push(`ADGATE_PUBLIC_KEYS_JSON: ${reason(error)}`);
    }
  }

  const keyId = env['ADGATE_SIGNING_KEY_ID'];
  const privatePem = env['ADGATE_SIGNING_KEY_PEM'];
  if (!blank(keyId) && !blank(privatePem) && keys[keyId as string] === undefined) {
    try {
      keys[keyId as string] = derivePublicPem((privatePem as string).replace(/\\n/g, '\n'));
    } catch (error) {
      issues.push(`ADGATE_SIGNING_KEY_PEM: ${reason(error)}`);
    }
  }

  try {
    const ring = createKeyRing(keys);
    const issue =
      issues.length > 0 ? issues.join('; ') : ring.key_ids.length === 0 ? NO_KEYS : null;
    return { ring, issue };
  } catch (error) {
    return {
      ring: createKeyRing({}),
      issue: `ADGATE_PUBLIC_KEYS_JSON: ${reason(error)}`,
    };
  }
};

/**
 * The ring for this process, built once. Hung off globalThis so `next dev` module reloads do
 * not rebuild it on every recompile, and loaded lazily so `next build` needs no keys.
 */
const globalForKeys = globalThis as unknown as { adgateDashboardVerifyKeys?: VerifyKeys };

export const verifyKeys = (): VerifyKeys => {
  const existing = globalForKeys.adgateDashboardVerifyKeys;
  if (existing !== undefined) {
    return existing;
  }
  loadRepoEnvFile();
  const keys = loadVerifyKeys();
  globalForKeys.adgateDashboardVerifyKeys = keys;
  return keys;
};
