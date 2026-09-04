import { sql } from 'drizzle-orm';

import type { DbOrTx } from '../db/client.js';
import { rateLimits } from '../db/tables/rate-limits.js';
import {
  assertBucketOptions,
  decisionFromTokens,
  type RateLimiter,
  type TokenBucketOptions,
} from './limiter.js';

/**
 * The Postgres token bucket: one INSERT ... ON CONFLICT DO UPDATE per take, with the refill
 * and the charge computed in the SET clause from the row's previous values. Postgres locks
 * the conflicting row and evaluates that expression against its latest committed version,
 * so two concurrent requests for one key see each other's charge and can never both spend
 * the last token (rate-limit/pg.integration.test.ts fires ten at once). The arithmetic is
 * takeToken (limiter.ts) in SQL; the returned balance carries the verdict in its sign.
 *
 * A database failure rejects; the middleware treats that as "allow and warn" (limiting fails
 * open, the evaluate pipeline still fails closed on its own database errors).
 */
export const createPgRateLimiter = (db: DbOrTx, options: TokenBucketOptions): RateLimiter => {
  assertBucketOptions(options);
  const { rps, burst } = options;
  return {
    take: async (key, now) => {
      // Previous balance with a refused request's charge given back (tokens + 1 when negative),
      // plus the refill for the time elapsed (never negative: a clock that went backwards
      // refills nothing), capped at the burst, minus this request's token.
      const held = sql`case when ${rateLimits.tokens} >= 0 then ${rateLimits.tokens} else ${rateLimits.tokens} + 1 end`;
      const elapsed = sql`greatest(0, extract(epoch from (excluded.updated_at - ${rateLimits.updatedAt}))::float8)`;
      const refilled = sql`least(${burst}::float8, ${held} + ${elapsed} * ${rps}::float8)`;
      const [row] = await db
        .insert(rateLimits)
        .values({ keyId: key, tokens: burst - 1, updatedAt: now })
        .onConflictDoUpdate({
          target: rateLimits.keyId,
          set: {
            tokens: sql`${refilled} - 1`,
            updatedAt: sql`greatest(${rateLimits.updatedAt}, excluded.updated_at)`,
          },
        })
        .returning({ tokens: rateLimits.tokens });
      if (row === undefined) {
        throw new Error('rate_limits upsert returned no row');
      }
      return decisionFromTokens(row.tokens, rps);
    },
  };
};
