import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { KEY_ID_PATTERN, PublicKeysJson } from '@adgate/schemas';

import { loadPrivateKey, loadPublicKey, verifyWithPublicKey } from './crypto.js';
import { AuditKeyError } from './errors.js';

/**
 * Key generation, the verification key ring and the ADGATE_PUBLIC_KEYS_JSON parser.
 * docs/audit.md: rotation means a new key_id, and old public keys remain available for
 * verification forever, so the ring holds every key ever used and a record's key_id selects
 * the one to verify with.
 */

export interface GenerateKeypairOptions {
  /** Clock for the default key_id. Defaults to Date.now. */
  now?: (() => number) | undefined;
  /** Explicit key_id; defaults to defaultKeyId(now), e.g. k_2026_09. */
  keyId?: string | undefined;
}

export interface GeneratedKeypair {
  key_id: string;
  /** PKCS#8 PEM: the ADGATE_SIGNING_KEY_PEM value. Keep it out of git and logs. */
  private_pem: string;
  /** SPKI PEM: the value to publish under key_id in ADGATE_PUBLIC_KEYS_JSON. */
  public_pem: string;
}

export const KEY_ID_PREFIX = 'k_';

export const isKeyId = (value: unknown): value is string =>
  typeof value === 'string' && KEY_ID_PATTERN.test(value);

/** `k_<YYYY>_<MM>` in UTC from the clock: the docs/audit.md example form (k_2026_09). */
export const defaultKeyId = (now: () => number = Date.now): string => {
  const date = new Date(now());
  if (Number.isNaN(date.getTime())) {
    throw new AuditKeyError('invalid_key_id', 'the clock did not return a valid time');
  }
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${KEY_ID_PREFIX}${date.getUTCFullYear()}_${month}`;
};

/** A fresh Ed25519 key pair as PEM strings, for local dev and key rotation. */
export const generateKeypair = (options: GenerateKeypairOptions = {}): GeneratedKeypair => {
  const key_id = options.keyId ?? defaultKeyId(options.now);
  if (!isKeyId(key_id)) {
    throw new AuditKeyError(
      'invalid_key_id',
      `key_id must match ${KEY_ID_PATTERN.source}`,
      String(key_id),
    );
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { key_id, private_pem: privateKey, public_pem: publicKey };
};

/** The SPKI PEM public half of a PKCS#8 PEM private key, to publish the signing key. */
export const derivePublicPem = (privatePem: string): string => {
  const exported = createPublicKey(loadPrivateKey(privatePem)).export({
    type: 'spki',
    format: 'pem',
  });
  return typeof exported === 'string' ? exported : exported.toString('utf8');
};

export type KeyRingVerification =
  | { ok: true; detail: `key_id=${string}` }
  | { ok: false; detail: 'unknown_key_id' | 'bad_signature' };

export interface PublicKeyRing {
  /** Every key_id in the ring, in insertion order. */
  readonly key_ids: readonly string[];
  has(keyId: string): boolean;
  /**
   * Verifies `signature` over `hashString` with the key `keyId` names. Never throws. The detail
   * is what the `signature` check of GET /v1/verify reports (`key_id=k_2026_09`).
   */
  verify(hashString: string, signature: string, keyId: string): KeyRingVerification;
}

/**
 * Builds the verification ring from key_id -> SPKI PEM (parsePublicKeysJson output, or an
 * object assembled at boot). Every PEM is loaded once here so verify() never parses PEM on the
 * request path; an unusable entry throws AuditKeyError naming its key_id.
 */
export const createKeyRing = (keys: Readonly<Record<string, string>>): PublicKeyRing => {
  if (keys === null || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new AuditKeyError('invalid_shape', 'public keys must be an object of key_id -> PEM');
  }
  const loaded = new Map<string, KeyObject>();
  for (const [keyId, pem] of Object.entries(keys)) {
    if (!isKeyId(keyId)) {
      throw new AuditKeyError(
        'invalid_key_id',
        `key_id must match ${KEY_ID_PATTERN.source}`,
        keyId,
      );
    }
    loaded.set(keyId, loadPublicKey(pem, keyId));
  }
  const key_ids: readonly string[] = Object.freeze([...loaded.keys()]);
  return {
    key_ids,
    has: (keyId) => loaded.has(keyId),
    verify: (hashString, signature, keyId) => {
      const key = typeof keyId === 'string' ? loaded.get(keyId) : undefined;
      if (key === undefined) {
        return { ok: false, detail: 'unknown_key_id' };
      }
      return verifyWithPublicKey(hashString, signature, key)
        ? { ok: true, detail: `key_id=${keyId}` }
        : { ok: false, detail: 'bad_signature' };
    },
  };
};

const describeIssues = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
  issues
    .map((issue) => `  - ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

/**
 * Parses the ADGATE_PUBLIC_KEYS_JSON value: a JSON object of key_id -> SPKI PEM, with the PEM
 * line breaks written as \n escapes inside the JSON string. The shape is validated with the
 * PublicKeysJson schema and every PEM is then loaded as an Ed25519 public key. Throws
 * AuditKeyError (reason invalid_json, invalid_shape or invalid_public_key) so boot fails loudly;
 * never call it on the request path. Pass the result to createKeyRing.
 */
export const parsePublicKeysJson = (json: string): PublicKeysJson => {
  if (typeof json !== 'string') {
    throw new AuditKeyError('invalid_json', 'public keys JSON must be a string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AuditKeyError('invalid_json', 'public keys JSON could not be parsed');
  }
  const result = PublicKeysJson.safeParse(parsed);
  if (!result.success) {
    throw new AuditKeyError(
      'invalid_shape',
      `public keys JSON is malformed:\n${describeIssues(result.error.issues)}`,
    );
  }
  for (const [keyId, pem] of Object.entries(result.data)) {
    loadPublicKey(pem, keyId);
  }
  return result.data;
};
