import { describe, expect, it } from 'vitest';

import {
  clientKey,
  createRateLimiter,
  LOGIN_RATE_LIMIT,
  LOGIN_RATE_WINDOW_MS,
  loginRateLimiter,
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

describe('clientKey', () => {
  it('takes the first x-forwarded-for hop', () => {
    expect(clientKey('203.0.113.7, 10.0.0.1', null)).toBe('203.0.113.7');
    expect(clientKey(' 203.0.113.7 ', null)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip and then to one shared bucket', () => {
    expect(clientKey(null, '198.51.100.4')).toBe('198.51.100.4');
    expect(clientKey('', '  ')).toBe('unknown');
    expect(clientKey(null, null)).toBe('unknown');
  });
});
