import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign as ed25519Sign,
  verify as ed25519Verify,
} from 'node:crypto';

import {
  ED25519_SIGNATURE_PATTERN,
  type Ed25519Signature,
  type Sha256Hash,
} from '@adgateio/schemas';

import { AuditKeyError } from './errors.js';

/**
 * Hashing and Ed25519 signing for the audit record (docs/audit.md). node:crypto only. This is
 * the single home of sha256 in core; policy_hash, PROMPT_VERSION, RULES_VERSION and the
 * classify cache key all come from here.
 *
 * What is signed: the UTF-8 bytes of the `record_hash` STRING exactly as it appears in the
 * record, prefix included (`sha256:<hex>`). docs/audit.md says "Ed25519 over record_hash" and a
 * verifier only ever holds that string, so neither the raw digest nor the bare hex is ever
 * signed. The signature is written as `ed25519:` + standard base64 (with padding) of the 64 raw
 * signature bytes, so a well-formed one is always 8 + 88 characters.
 */

/** Lowercase hex SHA-256 of a string's UTF-8 encoding, or of raw bytes. */
export const sha256Hex = (input: string | Uint8Array): string => {
  const hash = createHash('sha256');
  if (typeof input === 'string') {
    hash.update(input, 'utf8');
  } else {
    hash.update(input);
  }
  return hash.digest('hex');
};

/** The on-the-wire hash form used throughout the contract docs: `sha256:<hex>`. */
export const sha256Prefixed = (input: string | Uint8Array): Sha256Hash =>
  `sha256:${sha256Hex(input)}`;

export const SIGNATURE_PREFIX = 'ed25519:';
/** An Ed25519 signature is always 64 bytes (RFC 8032). */
export const ED25519_SIGNATURE_BYTES = 64;

const PRIVATE_PEM_HEADER = '-----BEGIN PRIVATE KEY-----';
const PUBLIC_PEM_HEADER = '-----BEGIN PUBLIC KEY-----';

/**
 * Loads an Ed25519 private key from its PKCS#8 PEM (the ADGATE_SIGNING_KEY_PEM shape). Throws
 * AuditKeyError for anything else: not a PEM, undecodable, or another algorithm.
 */
export const loadPrivateKey = (privatePem: string): KeyObject => {
  if (typeof privatePem !== 'string' || !privatePem.startsWith(PRIVATE_PEM_HEADER)) {
    throw new AuditKeyError('invalid_private_key', 'private key must be a PKCS#8 PEM');
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(privatePem);
  } catch {
    throw new AuditKeyError('invalid_private_key', 'private key PEM could not be decoded');
  }
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new AuditKeyError(
      'invalid_private_key',
      `private key is ${key.asymmetricKeyType ?? 'unknown'}, not ed25519`,
    );
  }
  return key;
};

/**
 * Loads an Ed25519 public key from its SPKI PEM. The header is checked before decoding because
 * node:crypto would otherwise derive a public key from a private PEM pasted by mistake into
 * ADGATE_PUBLIC_KEYS_JSON. keyId, when given, is named in the error.
 */
export const loadPublicKey = (publicPem: string, keyId?: string): KeyObject => {
  if (typeof publicPem !== 'string' || !publicPem.startsWith(PUBLIC_PEM_HEADER)) {
    throw new AuditKeyError('invalid_public_key', 'public key must be an SPKI PEM', keyId);
  }
  let key: KeyObject;
  try {
    key = createPublicKey(publicPem);
  } catch {
    throw new AuditKeyError('invalid_public_key', 'public key PEM could not be decoded', keyId);
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new AuditKeyError(
      'invalid_public_key',
      `public key is ${key.asymmetricKeyType ?? 'unknown'}, not ed25519`,
      keyId,
    );
  }
  return key;
};

/**
 * Signs `recordHash`, passed exactly as it appears in the record (`sha256:<hex>`), with the
 * Ed25519 private key given as PKCS#8 PEM. Deterministic: the same hash and key always give the
 * same signature. Throws AuditKeyError for an unusable key (validate the key at boot with
 * loadPrivateKey so this never fires on the request path) and TypeError for a missing hash.
 */
export const sign = (recordHash: string, privatePem: string): Ed25519Signature => {
  if (typeof recordHash !== 'string' || recordHash.length === 0) {
    throw new TypeError('sign: recordHash must be a non-empty string');
  }
  const key = loadPrivateKey(privatePem);
  const bytes = ed25519Sign(null, Buffer.from(recordHash, 'utf8'), key);
  return `${SIGNATURE_PREFIX}${bytes.toString('base64')}`;
};

/**
 * The 64 raw bytes of a well-formed `ed25519:<base64>` signature, or null when the prefix, the
 * base64 alphabet, the padding or the length is wrong. Never throws.
 */
export const decodeSignature = (signature: string): Uint8Array | null => {
  if (typeof signature !== 'string' || !ED25519_SIGNATURE_PATTERN.test(signature)) {
    return null;
  }
  const body = signature.slice(SIGNATURE_PREFIX.length);
  const bytes = Buffer.from(body, 'base64');
  // Buffer's decoder is lenient; re-encoding catches bad padding and stray trailing bits.
  if (bytes.length !== ED25519_SIGNATURE_BYTES || bytes.toString('base64') !== body) {
    return null;
  }
  return bytes;
};

/** verifySignature with an already loaded public key (what a key ring holds). Never throws. */
export const verifyWithPublicKey = (
  hashString: string,
  signature: string,
  key: KeyObject,
): boolean => {
  if (typeof hashString !== 'string' || hashString.length === 0) {
    return false;
  }
  const bytes = decodeSignature(signature);
  if (bytes === null) {
    return false;
  }
  try {
    return ed25519Verify(null, Buffer.from(hashString, 'utf8'), key, bytes);
  } catch {
    return false;
  }
};

/**
 * True when `signature` is a valid Ed25519 signature over the UTF-8 bytes of `hashString` (the
 * record_hash string, prefix included) under the SPKI PEM public key. Never throws: a wrong
 * prefix, bad base64, another key, a non-Ed25519 key or a garbage PEM all give false.
 */
export const verifySignature = (
  hashString: string,
  signature: string,
  publicPem: string,
): boolean => {
  let key: KeyObject;
  try {
    key = loadPublicKey(publicPem);
  } catch {
    return false;
  }
  return verifyWithPublicKey(hashString, signature, key);
};
