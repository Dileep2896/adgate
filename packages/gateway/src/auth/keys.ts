import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

/**
 * API key material (docs/api.md: `Authorization: Bearer <api_key>`). A presented key is
 * `ak_<prefix>_<secret>`: the prefix is a public lookup handle stored in clear in
 * api_keys.key_prefix, the secret is 32 random bytes that only ever exist in the caller's
 * hands and, hashed with argon2id, in api_keys.hashed_key. Verification is argon2.verify,
 * which compares in constant time by construction; nothing here compares a secret with ===.
 * No function in this module logs, and none of them keeps a secret beyond its return value.
 */

export const API_KEY_SCHEME = 'ak';
/** The prefix alphabet excludes `_` so the first `_` after `ak_` always ends the prefix. */
export const KEY_PREFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const KEY_PREFIX_LENGTH = 12;
export const KEY_SECRET_BYTES = 32;
/** ak_<8..12 alphanumerics>_<base64url secret>. Anchored: no whitespace, no trailing junk. */
export const API_KEY_PATTERN = /^ak_([A-Za-z0-9]{8,12})_([A-Za-z0-9_-]{32,128})$/;

const BEARER_PATTERN = /^Bearer +(\S+)$/i;

/**
 * argon2id at the OWASP minimum (19 MiB, 2 passes, 1 lane). API secrets carry 256 random
 * bits, so the cost here defends the stored hashes against a database leak, not against a
 * dictionary; every /v1 request pays one verify, which the libuv pool runs off the event loop.
 * The parameters are encoded in each hash, so changing them never breaks stored keys.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** PHC string: $argon2id$v=<n>$<m,t,p in any order>$<salt>$<hash>; argon2 writes the parameters alphabetically. */
const ARGON2ID_HASH_PATTERN =
  /^\$argon2id\$v=\d+\$[mtp]=\d+(?:,[mtp]=\d+){2}\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

export type RandomSource = (length: number) => Uint8Array;

const defaultRandom: RandomSource = (length) => randomBytes(length);

const bytesFrom = (random: RandomSource, length: number): Uint8Array => {
  const bytes = random(length);
  if (bytes.length < length) {
    throw new RangeError(`random source returned ${bytes.length} bytes, need ${length}`);
  }
  return bytes.subarray(0, length);
};

/** Uniform alphanumerics by rejection sampling: 248 = 4 * 62, so bytes below it carry no bias. */
const alphanumeric = (random: RandomSource, length: number): string => {
  const limit = KEY_PREFIX_ALPHABET.length * Math.floor(256 / KEY_PREFIX_ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const byte of bytesFrom(random, length)) {
      if (byte < limit && out.length < length) {
        out += KEY_PREFIX_ALPHABET[byte % KEY_PREFIX_ALPHABET.length];
      }
    }
  }
  return out;
};

export interface GeneratedApiKey {
  /** The full key to hand to the caller exactly once: ak_<prefix>_<secret>. */
  api_key: string;
  key_prefix: string;
  /** The part that gets hashed. Never stored, never logged. */
  secret: string;
}

export const generateApiKey = (random: RandomSource = defaultRandom): GeneratedApiKey => {
  const key_prefix = alphanumeric(random, KEY_PREFIX_LENGTH);
  const secret = Buffer.from(bytesFrom(random, KEY_SECRET_BYTES)).toString('base64url');
  return { api_key: `${API_KEY_SCHEME}_${key_prefix}_${secret}`, key_prefix, secret };
};

export interface ParsedApiKey {
  key_prefix: string;
  secret: string;
}

/** Splits a presented key, or null when it is not exactly the documented shape. */
export const parseApiKey = (presented: string): ParsedApiKey | null => {
  const match = API_KEY_PATTERN.exec(presented);
  const key_prefix = match?.[1];
  const secret = match?.[2];
  return key_prefix === undefined || secret === undefined ? null : { key_prefix, secret };
};

/** The key inside an `Authorization: Bearer <key>` header, or null for anything else. */
export const parseBearerHeader = (header: string | undefined): ParsedApiKey | null => {
  if (header === undefined) {
    return null;
  }
  const token = BEARER_PATTERN.exec(header)?.[1];
  return token === undefined ? null : parseApiKey(token);
};

export const hashApiSecret = (secret: string): Promise<string> =>
  argon2.hash(secret, ARGON2_OPTIONS);

export const isArgon2idHash = (hashedKey: string): boolean => ARGON2ID_HASH_PATTERN.test(hashedKey);

/**
 * True only when `secret` is the one `hashedKey` was made from. Never throws: a corrupt or
 * foreign hash verifies false, so a bad row can only ever deny access.
 */
export const verifyApiSecret = async (hashedKey: string, secret: string): Promise<boolean> => {
  if (!isArgon2idHash(hashedKey)) {
    return false;
  }
  try {
    return await argon2.verify(hashedKey, secret);
  } catch {
    return false;
  }
};

let decoy: Promise<string> | null = null;

/**
 * Spends the time a real verification would take, against a decoy hash made once per
 * process, so a request naming an unknown prefix is not measurably faster than one with a
 * wrong secret (a timing oracle on which prefixes exist). The result is discarded.
 */
export const burnVerifyTime = async (secret: string): Promise<void> => {
  decoy ??= hashApiSecret(generateApiKey().secret);
  await verifyApiSecret(await decoy, secret);
};
