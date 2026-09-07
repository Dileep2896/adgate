import type { Clock } from '@adgateio/core';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import type { AppEnv } from '../app-env.js';
import type { RateLimiter } from './limiter.js';

/**
 * `rateLimit({ limiter, keyOf })` takes one token per request from the bucket `keyOf(c)` names
 * (app.ts mounts it after bearerAuth on the write endpoints with the API key id). An empty
 * bucket is 429 { error: { code: 'rate_limited', message } } with Retry-After (whole seconds,
 * at least 1) and X-RateLimit-Remaining: 0, rendered by app.ts's HTTPException handler; an
 * allowed request carries X-RateLimit-Remaining with the tokens left.
 *
 * A limiter failure (Postgres down, a timeout) lets the request through with a warn line: the
 * limit protects capacity, and refusing every request because the limiter's own store is
 * unavailable would turn a degraded database into a full outage before the routes, which fail
 * closed on their own, ever ran. The warn carries the error's name only, never its message.
 */
export const RATE_LIMITED_MESSAGE = 'rate limit exceeded; retry after the Retry-After seconds';
export const RETRY_AFTER_HEADER = 'Retry-After';
export const REMAINING_HEADER = 'X-RateLimit-Remaining';

export interface RateLimitOptions {
  limiter: RateLimiter;
  /** The bucket a request draws from. Runs after bearerAuth, so c.get('auth') is available. */
  keyOf: (c: Context<AppEnv>) => string;
  /** Milliseconds clock for the refill. Defaults to Date.now. */
  now?: Clock | undefined;
}

const rateLimited = (retryAfterS: number): HTTPException =>
  new HTTPException(429, {
    message: RATE_LIMITED_MESSAGE,
    res: new Response(null, {
      status: 429,
      headers: { [RETRY_AFTER_HEADER]: String(retryAfterS), [REMAINING_HEADER]: '0' },
    }),
  });

export const rateLimit = (options: RateLimitOptions) => {
  const now = options.now ?? Date.now;
  return createMiddleware<AppEnv>(async (c, next) => {
    const log = c.get('logger');
    const key = options.keyOf(c);
    let remaining: number | null = null;
    try {
      const decision = await options.limiter.take(key, new Date(now()));
      if (!decision.allowed) {
        log.info({ status: 429, retry_after_s: decision.retry_after_s }, 'rate limited');
        throw rateLimited(decision.retry_after_s);
      }
      remaining = decision.remaining;
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      log.warn(
        { error_name: error instanceof Error ? error.name : 'NonError' },
        'rate limiter unavailable; request allowed',
      );
    }
    await next();
    if (remaining !== null) {
      c.res.headers.set(REMAINING_HEADER, String(remaining));
    }
  });
};
