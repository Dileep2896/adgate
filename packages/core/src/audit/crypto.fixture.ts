import { generateKeyPairSync } from 'node:crypto';

import { sha256Prefixed, SIGNATURE_PREFIX } from './crypto.js';
import { AuditKeyError } from './errors.js';
import { generateKeypair } from './keys.js';

/**
 * Shared material for the audit crypto tests. A non-test module because importing a *.test.ts
 * re-registers its tests in the importer. Keys are generated once per test run; nothing here is
 * a real secret.
 */
export const TEST_KEYS = generateKeypair({ keyId: 'k_test' });
export const OTHER_KEYS = generateKeypair({ keyId: 'k_other' });

/** A P-256 pair: syntactically valid PEMs of the wrong algorithm. */
export const EC_KEYS = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** A record_hash as S14 will produce it: the prefixed form. */
export const RECORD_HASH = sha256Prefixed('{"app_id":"app_01J","prev_hash":"genesis"}');

/** Flips the last hex digit of a `sha256:<hex>` string. */
export const flipLastHexDigit = (hash: string): string =>
  `${hash.slice(0, -1)}${hash.endsWith('0') ? '1' : '0'}`;

/**
 * Flips one bit of the first raw byte, keeping the `ed25519:<base64>` form well-formed.
 * Deterministic, unlike editing a base64 character (which may already hold the value written).
 */
export const tamperSignature = (signature: string): string => {
  const raw = Buffer.from(signature.slice(SIGNATURE_PREFIX.length), 'base64');
  raw[0] = (raw[0] ?? 0) ^ 0x01;
  return `${SIGNATURE_PREFIX}${raw.toString('base64')}`;
};

/** Runs fn and returns the AuditKeyError it throws; fails loudly on anything else. */
export const catchAuditKeyError = (fn: () => unknown): AuditKeyError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AuditKeyError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an AuditKeyError');
};
