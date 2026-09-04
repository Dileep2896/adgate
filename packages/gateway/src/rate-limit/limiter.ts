/**
 * Per-key rate limiting (docs/api.md: rate limits return 429 with a Retry-After header) as a
 * token bucket: a bucket holds at most `burst` tokens, gains `rps` tokens per second, and every
 * request takes one. The RateLimiter interface is what the middleware talks to; rate-limit/pg.ts
 * is the Postgres implementation (one atomic upsert per request) and the pure bucket math lives
 * here so the SQL and the unit tests agree on the numbers.
 *
 * Bucket encoding (shared with the rate_limits table): `tokens` is the balance AFTER the last
 * request, and a refused request is charged too. So tokens >= 0 means the last request was
 * allowed with that many tokens left; tokens in [-1, 0) means the bucket held tokens + 1 and
 * the request was refused. The next refill adds that 1 back first, so a refused request never
 * costs the caller anything, and one number carries both the balance and the verdict.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until a token is available; 0 when allowed, at least 1 when refused. */
  retry_after_s: number;
  /** Whole tokens left after this request; 0 when refused. */
  remaining: number;
}

export interface RateLimiter {
  /** Takes one token from `key`'s bucket as of `now`. May reject when the store is down. */
  take(key: string, now: Date): Promise<RateLimitDecision>;
}

export interface TokenBucketOptions {
  /** Refill rate, tokens per second (RATE_LIMIT_RPS). */
  rps: number;
  /** Bucket capacity: the most requests a key can make at once (RATE_LIMIT_BURST). */
  burst: number;
}

/** The stored bucket of one key, in the encoding described above. */
export interface BucketState {
  tokens: number;
  updatedAt: Date;
}

export interface TakeResult {
  state: BucketState;
  decision: RateLimitDecision;
}

export const assertBucketOptions = (options: TokenBucketOptions): void => {
  if (!Number.isFinite(options.rps) || options.rps <= 0) {
    throw new TypeError(`rate limit rps must be a positive number (got ${options.rps})`);
  }
  if (!Number.isInteger(options.burst) || options.burst < 1) {
    throw new TypeError(`rate limit burst must be a positive integer (got ${options.burst})`);
  }
};

/** The verdict encoded in a stored balance (see the header): sign = allowed, magnitude = how much. */
export const decisionFromTokens = (tokens: number, rps: number): RateLimitDecision =>
  tokens >= 0
    ? { allowed: true, retry_after_s: 0, remaining: Math.floor(tokens) }
    : { allowed: false, retry_after_s: Math.max(1, Math.ceil(-tokens / rps)), remaining: 0 };

/** The balance a stored state really holds: a refused request's charge is given back. */
export const heldTokens = (state: BucketState | null, options: TokenBucketOptions): number => {
  if (state === null) {
    return options.burst;
  }
  return state.tokens >= 0 ? state.tokens : state.tokens + 1;
};

/**
 * Refills `state` up to `now` and takes one token. Pure; the Postgres upsert does the same
 * arithmetic in SQL. A clock that went backwards refills nothing and keeps the later time.
 */
export const takeToken = (
  state: BucketState | null,
  now: Date,
  options: TokenBucketOptions,
): TakeResult => {
  const elapsedS =
    state === null ? 0 : Math.max(0, (now.getTime() - state.updatedAt.getTime()) / 1000);
  const refilled = Math.min(options.burst, heldTokens(state, options) + elapsedS * options.rps);
  const tokens = refilled - 1;
  const updatedAt = state !== null && state.updatedAt > now ? state.updatedAt : now;
  return { state: { tokens, updatedAt }, decision: decisionFromTokens(tokens, options.rps) };
};
