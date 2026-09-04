/**
 * A fixed-window in-memory rate limiter for the login form. One process, one Map: there is no
 * Redis in this project (CLAUDE.md) and a per-instance limiter is enough to make guessing the
 * admin password over HTTP annoying rather than free. It is not a security boundary on its
 * own; the password check is (lib/session.ts).
 */

export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_RATE_WINDOW_MS = 60_000;
/** Entries are pruned once the map grows past this, so a spray of IPs cannot grow it forever. */
export const DEFAULT_MAX_KEYS = 10_000;

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number | undefined;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts left in the current window after this one. */
  remaining: number;
  /** Seconds until the window resets; 0 when the request was allowed. */
  retryAfterS: number;
}

export interface RateLimiter {
  /** Charges one attempt against `key`. */
  check: (key: string, now: Date) => RateLimitDecision;
  /** Test and dev-server helper: forgets every window. */
  reset: () => void;
  size: () => number;
}

interface Window {
  startedAt: number;
  count: number;
}

export const createRateLimiter = (options: RateLimiterOptions): RateLimiter => {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new TypeError('createRateLimiter: limit must be a positive integer');
  }
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
    throw new TypeError('createRateLimiter: windowMs must be a positive integer');
  }
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const windows = new Map<string, Window>();

  const prune = (nowMs: number): void => {
    for (const [key, window] of windows) {
      if (nowMs - window.startedAt >= options.windowMs) {
        windows.delete(key);
      }
    }
  };

  return {
    check: (key, now) => {
      const nowMs = now.getTime();
      if (windows.size >= maxKeys) {
        prune(nowMs);
      }
      const existing = windows.get(key);
      const window =
        existing === undefined || nowMs - existing.startedAt >= options.windowMs
          ? { startedAt: nowMs, count: 0 }
          : existing;
      window.count += 1;
      windows.set(key, window);

      const allowed = window.count <= options.limit;
      const elapsed = nowMs - window.startedAt;
      return {
        allowed,
        remaining: Math.max(0, options.limit - window.count),
        retryAfterS: allowed ? 0 : Math.max(1, Math.ceil((options.windowMs - elapsed) / 1000)),
      };
    },
    reset: () => windows.clear(),
    size: () => windows.size,
  };
};

/**
 * The login limiter, one per process. It hangs off globalThis so `next dev` module reloads do
 * not hand an attacker a fresh budget on every recompile.
 */
const globalForLimiter = globalThis as unknown as { adgateLoginRateLimiter?: RateLimiter };

export const loginRateLimiter = (): RateLimiter => {
  const existing = globalForLimiter.adgateLoginRateLimiter;
  if (existing !== undefined) {
    return existing;
  }
  const limiter = createRateLimiter({ limit: LOGIN_RATE_LIMIT, windowMs: LOGIN_RATE_WINDOW_MS });
  globalForLimiter.adgateLoginRateLimiter = limiter;
  return limiter;
};

/**
 * The rate limit key for a login attempt. Behind a proxy the client address is the first
 * x-forwarded-for hop; with no header every attempt shares the `unknown` bucket, which is the
 * safe direction (it limits harder, never less).
 */
export const clientKey = (forwardedFor: string | null, realIp: string | null): string => {
  const first = (forwardedFor ?? '').split(',')[0]?.trim() ?? '';
  if (first !== '') {
    return first;
  }
  const real = (realIp ?? '').trim();
  return real === '' ? 'unknown' : real;
};
