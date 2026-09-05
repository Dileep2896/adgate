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

  /**
   * Pruning only drops ELAPSED windows, so a spray of distinct keys inside a single window
   * leaves the map full: without this the map would grow past maxKeys and every check() would
   * pay for the scan above. Oldest window first, so the entry closest to expiring goes.
   *
   * Evicting a key forgets its budget, which is a real (small) hole: an attacker who can mint
   * maxKeys distinct keys per window can push their own window out early. That is the price of
   * a bounded in-memory map, and the reason this limiter is documented as friction rather than
   * as a security boundary - the password check is the boundary.
   */
  const evictOldest = (count: number): void => {
    const oldest = [...windows.entries()]
      .sort(([, a], [, b]) => a.startedAt - b.startedAt)
      .slice(0, count);
    for (const [key] of oldest) {
      windows.delete(key);
    }
  };

  return {
    check: (key, now) => {
      const nowMs = now.getTime();
      if (windows.size >= maxKeys && !windows.has(key)) {
        prune(nowMs);
        if (windows.size >= maxKeys) {
          evictOldest(windows.size - maxKeys + 1);
        }
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

/** Every attempt whose client cannot be identified shares this bucket: it limits harder. */
export const SHARED_BUCKET = 'unknown';

/** What the request says about who sent it. Nothing here is trusted by default. */
export interface ClientAddress {
  /** x-forwarded-for exactly as received: a client-controlled header unless a proxy rewrote it. */
  forwardedFor: string | null;
  /** x-real-ip, written by the same proxy that writes x-forwarded-for, so trusted with it. */
  realIp: string | null;
  /**
   * The peer address the platform reports, when it reports one. Next's Node server does not
   * expose the socket to a route handler - it folds the peer address into x-forwarded-for when
   * the client sent no such header - so this is null there, and an untrusted deployment falls
   * back to one shared bucket rather than to a header anyone can set.
   */
  peer?: string | null;
}

const trimmed = (value: string | null | undefined): string => (value ?? '').trim();

/**
 * The rate limit key for a login attempt.
 *
 * TRUST NOTHING UNLESS CONFIGURED. `x-forwarded-for` is a request header: a client talking to
 * the dashboard directly can put anything in it, and keying the limiter on the FIRST hop let
 * one attacker have an unlimited number of buckets - which is the same as no rate limit at all.
 * `trustedHops` (0 by default, TRUST_PROXY / TRUSTED_PROXY_HOPS - lib/env.ts) says how many
 * proxies really sit in front of this process:
 *
 *   0  the header is ignored entirely. The platform peer address is used when there is one, and
 *      otherwise every attempt shares one bucket. That limits harder, never less.
 *   n  the client is the hop the outermost trusted proxy appended: the nth entry from the RIGHT.
 *      With one proxy and `spoofed, 203.0.113.7` that is 203.0.113.7, and the value the client
 *      injected is skipped. A shorter list than expected clamps to the leftmost entry.
 */
export const clientKey = (address: ClientAddress, trustedHops: number): string => {
  const peer = trimmed(address.peer);
  const fallback = peer === '' ? SHARED_BUCKET : peer;
  if (trustedHops <= 0) {
    return fallback;
  }
  const hops = trimmed(address.forwardedFor)
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop !== '');
  const client = hops[Math.max(0, hops.length - trustedHops)];
  if (client !== undefined) {
    return client;
  }
  const real = trimmed(address.realIp);
  return real === '' ? fallback : real;
};
