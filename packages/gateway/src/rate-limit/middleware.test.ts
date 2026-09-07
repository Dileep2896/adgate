import { ErrorResponse } from '@adgateio/schemas';
import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { AppEnv } from '../app-env.js';
import { createLogger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import type { RateLimiter } from './limiter.js';
import {
  RATE_LIMITED_MESSAGE,
  rateLimit,
  REMAINING_HEADER,
  RETRY_AFTER_HEADER,
} from './middleware.js';
import { createFailingRateLimiter, createMemoryRateLimiter } from './test-support.js';

/** The middleware over the in-memory bucket and a failing limiter; no database. */
const T0 = Date.parse('2026-09-03T12:00:00Z');

const build = (limiter: RateLimiter, clock: () => number = () => T0) => {
  const { lines, stream } = collectLogs();
  const app = createApp({
    logger: createLogger({ level: 'info' }, stream),
    corsAllowedOrigins: [],
  });
  const keyOf = (c: Context<AppEnv>): string => c.req.header('x-key') ?? 'anon';
  app.post('/w', rateLimit({ limiter, keyOf, now: clock }), (c) => c.json({ ok: true }));
  const post = (key = 'k1') => app.request('/w', { method: 'POST', headers: { 'x-key': key } });
  return { app, lines, post };
};

describe('rateLimit middleware', () => {
  it('passes burst requests with a falling X-RateLimit-Remaining, then answers 429', async () => {
    const { post } = build(createMemoryRateLimiter({ rps: 5, burst: 2 }));
    const first = await post();
    expect(first.status).toBe(200);
    expect(first.headers.get(REMAINING_HEADER)).toBe('1');
    const second = await post();
    expect(second.status).toBe(200);
    expect(second.headers.get(REMAINING_HEADER)).toBe('0');

    const third = await post();
    expect(third.status).toBe(429);
    expect(third.headers.get(RETRY_AFTER_HEADER)).toBe('1');
    expect(third.headers.get(REMAINING_HEADER)).toBe('0');
    expect(third.headers.get('content-type')).toContain('application/json');
    expect(ErrorResponse.parse(await third.json())).toEqual({
      error: { code: 'rate_limited', message: RATE_LIMITED_MESSAGE },
    });
  });

  it('lets a request through again once the clock has refilled a token', async () => {
    let now = T0;
    const { post } = build(createMemoryRateLimiter({ rps: 1, burst: 1 }), () => now);
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(429);
    now += 1_000;
    expect((await post()).status).toBe(200);
  });

  it('keeps one bucket per key', async () => {
    const { post } = build(createMemoryRateLimiter({ rps: 1, burst: 1 }));
    expect((await post('a')).status).toBe(200);
    expect((await post('a')).status).toBe(429);
    expect((await post('b')).status).toBe(200);
  });

  it('fails open with a warn line when the limiter throws', async () => {
    const { post, lines } = build(createFailingRateLimiter(new Error('connection refused')));
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get(REMAINING_HEADER)).toBeNull();
    const warn = lines.find((line) => line.includes('rate limiter unavailable'));
    expect(warn).toBeDefined();
    expect(JSON.parse(warn ?? '{}')).toMatchObject({ level: 40, error_name: 'Error' });
    expect(warn).not.toContain('connection refused');
  });

  it('logs the refusal with the retry delay and no key material', async () => {
    const { post, lines } = build(createMemoryRateLimiter({ rps: 5, burst: 1 }));
    await post('secret-key-id');
    await post('secret-key-id');
    const line = lines.find((entry) => entry.includes('"msg":"rate limited"'));
    expect(JSON.parse(line ?? '{}')).toMatchObject({ status: 429, retry_after_s: 1 });
    expect(line).not.toContain('secret-key-id');
  });
});
