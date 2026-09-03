import type { Classification } from '@adgate/schemas';

import { sha256Prefixed } from '../audit/crypto.js';
import { PROMPT_VERSION } from './llm/prompt.js';
import { normalizeText } from './rules/normalize.js';
import { RULES_VERSION } from './rules/version.js';
import type { ClassifyCache, ClassifyPolicy } from './types.js';

export type { ClassifyCache } from './types.js';

/**
 * Classification cache (docs/BUILD_GUIDE.md Phase 2, design step 3): an in-memory LRU with a
 * TTL, 50k entries and 10 minutes by default. The ClassifyCache interface is deliberately two
 * methods so the gateway can swap in a Postgres-backed cache without touching classify().
 */
export const DEFAULT_CACHE_MAX_ENTRIES = 50_000;
export const DEFAULT_CACHE_TTL_MS = 600_000;

/**
 * `sha256:<hex>` over the normalized text plus everything that changes the answer: the prompt
 * version, the rules version and the two policy fields the merge reads. Including the policy
 * keeps apps with different sensitive_detection or min_confidence from sharing merged results
 * in one process-wide cache. Normalization (rules/normalize.ts) makes case, punctuation and
 * whitespace variants of the same turn share one entry. No message text is recoverable from it.
 */
export const classifyCacheKey = (text: string, policy: ClassifyPolicy): string =>
  sha256Prefixed(
    [
      normalizeText(text),
      PROMPT_VERSION,
      RULES_VERSION,
      policy.sensitive_detection,
      String(policy.min_confidence),
    ].join('\n'),
  );

export interface LruCacheOptions {
  maxEntries?: number | undefined;
  ttlMs?: number | undefined;
  /** Clock for expiry. Defaults to Date.now; tests inject a fake. */
  now?: (() => number) | undefined;
}

export interface LruCache extends ClassifyCache {
  readonly size: number;
  delete(key: string): boolean;
  clear(): void;
}

interface Entry {
  value: Classification;
  expiresAt: number;
}

/**
 * Map insertion order doubles as the recency list: a get re-inserts the entry at the end, a
 * set beyond maxEntries evicts from the front. Expired entries are misses and are removed when
 * they are looked up. Option errors throw here, at configuration time, never on the request path.
 */
export const createLruCache = (options: LruCacheOptions = {}): LruCache => {
  const maxEntries = options.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError(`maxEntries must be a positive integer, got ${maxEntries}`);
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError(`ttlMs must be a positive number of milliseconds, got ${ttlMs}`);
  }
  const entries = new Map<string, Entry>();

  return {
    get size() {
      return entries.size;
    },
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) {
        return undefined;
      }
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) {
          break;
        }
        entries.delete(oldest.value);
      }
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
};
