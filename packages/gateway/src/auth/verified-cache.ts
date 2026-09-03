import { createHash } from 'node:crypto';

import type { AuthContext } from '../app-env.js';

/**
 * A small in-memory cache of recently verified API keys so a hot key skips the argon2id
 * verification (about 15 ms of CPU per request) for a minute. The entry key is
 * (key_prefix, sha256(secret)): the secret itself is never stored, and a different secret
 * under a cached prefix simply misses and pays the full verification. A hit proves only that
 * the presented secret matched the stored hash recently: the middleware still loads the key
 * row on every request, so a revocation written to the database (any process) is honoured at
 * once, and revokeApiKey drops the entry in-process as well. Bounded: the oldest entries go
 * first past maxEntries; expired ones are dropped when looked up.
 */
export const VERIFIED_KEY_TTL_MS = 60_000;
export const VERIFIED_KEY_MAX_ENTRIES = 10_000;

export interface VerifiedKeyCacheOptions {
  ttlMs?: number | undefined;
  maxEntries?: number | undefined;
  /** Clock for expiry. Defaults to Date.now. */
  now?: (() => number) | undefined;
}

export interface VerifiedKeyCache {
  /** The context verified for this prefix and secret within the TTL, or undefined. */
  get(keyPrefix: string, secret: string): AuthContext | undefined;
  set(keyPrefix: string, secret: string, auth: AuthContext): void;
  /** Drops every entry of a key id (revocation). */
  invalidate(keyId: string): void;
  clear(): void;
  readonly size: number;
}

interface Entry {
  auth: AuthContext;
  expiresAt: number;
}

const entryKey = (keyPrefix: string, secret: string): string =>
  `${keyPrefix}\n${createHash('sha256').update(secret, 'utf8').digest('hex')}`;

export const createVerifiedKeyCache = (options: VerifiedKeyCacheOptions = {}): VerifiedKeyCache => {
  const ttlMs = options.ttlMs ?? VERIFIED_KEY_TTL_MS;
  const maxEntries = options.maxEntries ?? VERIFIED_KEY_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  if (!(ttlMs > 0) || !Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError(
      'verified key cache: ttlMs must be positive and maxEntries a positive integer',
    );
  }
  const entries = new Map<string, Entry>();
  return {
    get size() {
      return entries.size;
    },
    get(keyPrefix, secret) {
      const key = entryKey(keyPrefix, secret);
      const entry = entries.get(key);
      if (entry === undefined) {
        return undefined;
      }
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return { ...entry.auth };
    },
    set(keyPrefix, secret, auth) {
      const key = entryKey(keyPrefix, secret);
      entries.delete(key);
      entries.set(key, { auth: { ...auth }, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) {
          break;
        }
        entries.delete(oldest.value);
      }
    },
    invalidate(keyId) {
      for (const [key, entry] of entries) {
        if (entry.auth.key_id === keyId) {
          entries.delete(key);
        }
      }
    },
    clear() {
      entries.clear();
    },
  };
};
