import { doublePrecision, pgTable, text } from 'drizzle-orm/pg-core';

import { timestamptz } from './columns.js';

/**
 * Token buckets for the per-key rate limit (docs/api.md: 429 with Retry-After). One row per
 * limiter key (the api_keys id on the write endpoints; no FK so the limiter stays generic and
 * a row can never block a request). rate-limit/pg.ts refills and takes in ONE upsert so
 * concurrent requests cannot double-spend.
 *
 * Encoding of `tokens`: the balance after the last request. A refused request is still
 * charged, so a value in [-1, 0) means "the bucket held tokens + 1 and the last request was
 * refused"; the next refill adds that 1 back before topping up. A value >= 0 means the last
 * request was allowed and this many tokens are left. See takeToken in rate-limit/limiter.ts.
 */
export const rateLimits = pgTable('rate_limits', {
  keyId: text('key_id').primaryKey(),
  tokens: doublePrecision('tokens').notNull(),
  /** When the balance was last computed; refill covers the interval up to the next request. */
  updatedAt: timestamptz('updated_at').notNull(),
});
