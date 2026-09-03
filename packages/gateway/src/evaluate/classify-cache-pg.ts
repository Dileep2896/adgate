import { type ClassifyCache, type Clock, DEFAULT_CACHE_TTL_MS, type LruCache } from '@adgate/core';
import { Classification } from '@adgate/schemas';
import { and, eq, gt } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { DbOrTx } from '../db/client.js';
import { classifyCache } from '../db/tables/caps.js';

/**
 * The two-tier classifier cache (docs/architecture.md step 4): the classify_cache table shared
 * by every gateway process, in front of one in-memory LRU per process. classify() only knows
 * the synchronous ClassifyCache interface, so the Postgres tier is consulted BEFORE classify
 * runs (open(): a hit seeds the LRU) and written through AFTER (set() queues the upsert, which
 * runs alongside mediation and the audit transaction; flush() awaits it before the response).
 * Rows carry classifyCacheKey() as their key, a Classification and a 10 minute expiry, and are
 * validated with the schema on read. Every database error is swallowed and logged: a cache
 * failure costs one LLM call, never the request.
 */
export interface PgClassifyCache {
  get(key: string, log: Logger): Promise<Classification | undefined>;
  set(key: string, value: Classification, log: Logger): Promise<void>;
}

export interface PgClassifyCacheOptions {
  now?: Clock | undefined;
  /** Row lifetime. Defaults to the LRU's DEFAULT_CACHE_TTL_MS (10 minutes). */
  ttlMs?: number | undefined;
}

const errorName = (error: unknown): string =>
  error instanceof Error && error.name !== '' ? error.name : 'NonError';

export const createPgClassifyCache = (
  db: DbOrTx,
  options: PgClassifyCacheOptions = {},
): PgClassifyCache => {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  return {
    async get(key, log) {
      try {
        const [row] = await db
          .select({ classification: classifyCache.classification })
          .from(classifyCache)
          .where(and(eq(classifyCache.hash, key), gt(classifyCache.expiresAt, new Date(now()))))
          .limit(1);
        if (row === undefined) {
          return undefined;
        }
        const parsed = Classification.safeParse(row.classification);
        if (!parsed.success) {
          log.warn({ cache_key: key }, 'classify_cache row is not a Classification; ignored');
          return undefined;
        }
        return parsed.data;
      } catch (error) {
        log.warn({ error_name: errorName(error) }, 'classify_cache read failed; miss');
        return undefined;
      }
    },
    async set(key, value, log) {
      const expiresAt = new Date(now() + ttlMs);
      try {
        await db
          .insert(classifyCache)
          .values({ hash: key, classification: value, expiresAt })
          .onConflictDoUpdate({
            target: classifyCache.hash,
            set: { classification: value, expiresAt },
          });
      } catch (error) {
        log.warn({ error_name: errorName(error) }, 'classify_cache write failed; ignored');
      }
    },
  };
};

/** Where open() found the key: the process LRU, the Postgres tier, or nowhere. */
export type CacheSource = 'lru' | 'pg' | 'miss';

export interface RequestClassifyCache {
  /** The synchronous view classify() reads and writes. */
  cache: ClassifyCache;
  source: CacheSource;
  /** Resolves once every write queued by cache.set has been attempted (never rejects). */
  flush(): Promise<void>;
}

export interface LayeredClassifyCache {
  /** Looks `key` up in the LRU, then Postgres (seeding the LRU on a hit), for one request. */
  open(key: string, log: Logger): Promise<RequestClassifyCache>;
  /** Empties the in-memory tier (tests). */
  clear(): void;
}

export const createLayeredClassifyCache = (
  lru: LruCache,
  pg: PgClassifyCache,
): LayeredClassifyCache => ({
  async open(key, log) {
    let source: CacheSource = 'miss';
    if (lru.get(key) !== undefined) {
      source = 'lru';
    } else {
      const hit = await pg.get(key, log);
      if (hit !== undefined) {
        lru.set(key, hit);
        source = 'pg';
      }
    }
    const pending: Promise<void>[] = [];
    const cache: ClassifyCache = {
      get: (cacheKey) => lru.get(cacheKey),
      set: (cacheKey, value) => {
        lru.set(cacheKey, value);
        pending.push(pg.set(cacheKey, value, log));
      },
    };
    return {
      cache,
      source,
      flush: async () => {
        await Promise.all(pending);
      },
    };
  },
  clear() {
    lru.clear();
  },
});
