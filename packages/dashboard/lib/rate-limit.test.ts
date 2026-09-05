import { describe, expect, it } from 'vitest';

import {
  clientKey,
  createRateLimiter,
  LOGIN_RATE_LIMIT,
  LOGIN_RATE_WINDOW_MS,
  loginRateLimiter,
  SHARED_BUCKET,
} from './rate-limit';

const at = (offsetMs: number): Date => new Date(Date.parse('2026-09-04T12:00:00.000Z') + offsetMs);

describe('createRateLimiter', () => {
  it('allows exactly `limit` attempts per window and then blocks', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.check('a', at(0))).toEqual({ allowed: true, remaining: 2, retryAfterS: 0 });
    expect(limiter.check('a', at(1))).toEqual({ allowed: true, remaining: 1, retryAfterS: 0 });
    expect(limiter.check('a', at(2))).toEqual({ allowed: true, remaining: 0, retryAfterS: 0 });
    expect(limiter.check('a', at(3))).toEqual({ allowed: false, remaining: 0, retryAfterS: 60 });
  });

  it('keeps a separate window per key', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check('a', at(0)).allowed).toBe(true);
    expect(limiter.check('b', at(0)).allowed).toBe(true);
    expect(limiter.check('a', at(0)).allowed).toBe(false);
    expect(limiter.check('b', at(0)).allowed).toBe(false);
  });

  it('starts a fresh window once the old one has elapsed', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.check('a', at(0)).allowed).toBe(true);
    expect(limiter.check('a', at(10)).allowed).toBe(true);
    expect(limiter.check('a', at(20)).allowed).toBe(false);
    expect(limiter.check('a', at(59_999)).allowed).toBe(false);
    expect(limiter.check('a', at(60_000))).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterS: 0,
    });
  });

  it('counts down retryAfterS as the window drains', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.check('a', at(0));
    expect(limiter.check('a', at(30_000)).retryAfterS).toBe(30);
    expect(limiter.check('a', at(59_500)).retryAfterS).toBe(1);
  });

  it('prunes elapsed windows instead of growing without bound', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 4 });
    for (let index = 0; index < 4; index += 1) {
      limiter.check(`ip-${index}`, at(0));
    }
    expect(limiter.size()).toBe(4);
    limiter.check('ip-late', at(5_000));
    expect(limiter.size()).toBe(1);
  });

  /**
   * Pruning drops elapsed windows only, so a spray of distinct keys INSIDE one window has
   * nothing to prune: without eviction the map grows past maxKeys for as long as the spray
   * lasts and every check() pays for the scan.
   */
  it('evicts the oldest window when the map is full inside one window', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 4 });
    for (let index = 0; index < 20; index += 1) {
      limiter.check(`ip-${index}`, at(index));
      expect(limiter.size()).toBeLessThanOrEqual(4);
    }
    expect(limiter.size()).toBe(4);

    // The four newest keys are the ones still remembered: each is over its budget of 1.
    for (let index = 16; index < 20; index += 1) {
      expect(limiter.check(`ip-${index}`, at(20)).allowed).toBe(false);
    }
    expect(limiter.size()).toBe(4);
  });

  it('does not evict the key it is being asked about', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, maxKeys: 2 });
    limiter.check('a', at(0));
    limiter.check('b', at(1));
    expect(limiter.check('a', at(2)).allowed).toBe(true);
    expect(limiter.check('a', at(3)).allowed).toBe(false);
  });

  it('rejects nonsense options', () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1_000 })).toThrow(TypeError);
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow(TypeError);
  });
});

describe('loginRateLimiter', () => {
  it('is one shared limiter with the documented budget', () => {
    const limiter = loginRateLimiter();
    expect(loginRateLimiter()).toBe(limiter);
    limiter.reset();

    const now = at(0);
    for (let attempt = 0; attempt < LOGIN_RATE_LIMIT; attempt += 1) {
      expect(limiter.check('1.2.3.4', now).allowed).toBe(true);
    }
    const blocked = limiter.check('1.2.3.4', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterS).toBe(LOGIN_RATE_WINDOW_MS / 1000);
    limiter.reset();
  });
});

describe('clientKey with no trusted proxy (the default)', () => {
  /**
   * x-forwarded-for is a REQUEST header. A client that reaches the dashboard directly can vary
   * it per attempt, and keying on it would give one attacker unlimited buckets - the exact
   * bypass this mode exists to close.
   */
  it('ignores the forwarded headers entirely', () => {
    expect(clientKey({ forwardedFor: '203.0.113.7, 10.0.0.1', realIp: '198.51.100.4' }, 0)).toBe(
      SHARED_BUCKET,
    );
    expect(clientKey({ forwardedFor: 'anything-i-like', realIp: null }, 0)).toBe(SHARED_BUCKET);
  });

  it('uses the platform peer address when there is one', () => {
    expect(clientKey({ forwardedFor: 'spoofed', realIp: null, peer: '192.0.2.9' }, 0)).toBe(
      '192.0.2.9',
    );
  });

  it('shares one bucket when nothing identifies the client', () => {
    expect(clientKey({ forwardedFor: null, realIp: null }, 0)).toBe('unknown');
    expect(clientKey({ forwardedFor: '', realIp: '  ', peer: ' ' }, 0)).toBe('unknown');
  });
});

describe('clientKey behind trusted proxies', () => {
  it('takes the hop the outermost trusted proxy appended, not the first', () => {
    // One proxy: it appended the address it saw, so the LAST entry is the client and anything
    // the client put in front of it is skipped.
    expect(clientKey({ forwardedFor: 'spoofed, 203.0.113.7', realIp: null }, 1)).toBe(
      '203.0.113.7',
    );
    expect(clientKey({ forwardedFor: ' 203.0.113.7 ', realIp: null }, 1)).toBe('203.0.113.7');
    // Two proxies: the client is two from the right.
    expect(clientKey({ forwardedFor: 'spoofed, 203.0.113.7, 10.0.0.1', realIp: null }, 2)).toBe(
      '203.0.113.7',
    );
  });

  it('clamps to the leftmost entry when the list is shorter than expected', () => {
    expect(clientKey({ forwardedFor: '203.0.113.7', realIp: null }, 3)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then the peer, then one shared bucket', () => {
    expect(clientKey({ forwardedFor: null, realIp: '198.51.100.4' }, 1)).toBe('198.51.100.4');
    expect(clientKey({ forwardedFor: '', realIp: '  ', peer: '192.0.2.9' }, 1)).toBe('192.0.2.9');
    expect(clientKey({ forwardedFor: null, realIp: null }, 1)).toBe('unknown');
  });
});
