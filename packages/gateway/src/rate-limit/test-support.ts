import {
  assertBucketOptions,
  type BucketState,
  type RateLimiter,
  takeToken,
  type TokenBucketOptions,
} from './limiter.js';

/**
 * Rate limiter fakes for tests (not a test file, not on the package index). The gateway ships
 * only the Postgres limiter; unit tests use these so no test of the middleware needs a database.
 */

/** A limiter over takeToken and a Map: the same numbers as Postgres, in one process. */
export const createMemoryRateLimiter = (
  options: TokenBucketOptions,
): RateLimiter & { buckets: Map<string, BucketState> } => {
  assertBucketOptions(options);
  const buckets = new Map<string, BucketState>();
  return {
    buckets,
    take: async (key, now) => {
      const { state, decision } = takeToken(buckets.get(key) ?? null, now, options);
      buckets.set(key, state);
      return decision;
    },
  };
};

/** A limiter whose take() rejects every time, as a database outage would. */
export const createFailingRateLimiter = (
  error: Error = new Error('limiter down'),
): RateLimiter => ({
  take: async () => {
    throw error;
  },
});
