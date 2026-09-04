import { describe, expect, it } from 'vitest';

import { UsageError } from './args.js';
import {
  DEFAULT_LOAD_URL,
  type LoadArgs,
  type LoadSample,
  parseLoadArgs,
  percentile,
  runLoad,
  summarize,
} from './load.js';

/** The load script without a gateway: argument parsing, statistics and the worker pool over a fake fetch. */
const ARGS: LoadArgs = {
  url: 'http://gw.test',
  key: 'ak_abcdefghijkl_secret',
  app: 'app_01LOAD',
  requests: 25,
  concurrency: 4,
  body: null,
};

describe('parseLoadArgs', () => {
  it('applies the defaults and trims a trailing slash off the url', () => {
    expect(parseLoadArgs(['--key', 'k', '--app', 'app_1', '--url', 'http://x:1/'])).toEqual({
      help: false,
      url: 'http://x:1',
      key: 'k',
      app: 'app_1',
      requests: 200,
      concurrency: 10,
      body: null,
    });
    expect(parseLoadArgs(['--key', 'k', '--app', 'a']).help).toBe(false);
    expect((parseLoadArgs(['--key', 'k', '--app', 'a']) as { url: string }).url).toBe(
      DEFAULT_LOAD_URL,
    );
    expect(parseLoadArgs(['--help'])).toEqual({ help: true });
  });

  it('requires the key and app and positive integer counts', () => {
    expect(() => parseLoadArgs(['--app', 'a'])).toThrow(/--key is required/);
    expect(() => parseLoadArgs(['--key', 'k'])).toThrow(/--app is required/);
    expect(() => parseLoadArgs(['--key', 'k', '--app', 'a', '--requests', '0'])).toThrow(
      UsageError,
    );
    expect(() => parseLoadArgs(['--key', 'k', '--app', 'a', '--concurrency', '2.5'])).toThrow(
      /--concurrency must be a positive integer/,
    );
  });
});

describe('percentile', () => {
  it('uses the nearest rank and handles the edges', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile(sorted, 99)).toBe(10);
    expect(percentile(sorted, 100)).toBe(10);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('summarize', () => {
  it('prints counts, the decision mix, percentiles and the mean server latency', () => {
    const samples: LoadSample[] = [
      { status: 200, ms: 10, decision: 'serve', reason: null, latency_ms: 4 },
      { status: 200, ms: 30, decision: 'suppress', reason: 'no_fill', latency_ms: 6 },
      { status: 429, ms: 2 },
      { status: 0, ms: 1, error: 'TypeError' },
    ];
    const text = summarize(samples, 500, ARGS);
    expect(text).toContain('4 requests, concurrency 4, POST http://gw.test/v1/evaluate');
    expect(text).toContain('wall time      500 ms (8.0 req/s)');
    expect(text).toContain('status         200: 2, 429: 1');
    expect(text).toContain('errors         1 (TypeError: 1)');
    expect(text).toContain('decisions      serve: 1, suppress/no_fill: 1');
    expect(text).toContain('p50 10.0 ms  p95 30.0 ms  p99 30.0 ms  max 30.0 ms');
    expect(text).toContain('mean 5.0 ms (latency_ms over 2 responses)');
    expect(summarize([], 0, ARGS)).toContain('server latency n/a');
  });
});

describe('runLoad', () => {
  it('sends every request with a fresh conversation, the given app and key, at most concurrency in flight', async () => {
    const seen: Record<string, unknown>[] = [];
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      expect(url).toBe('http://gw.test/v1/evaluate');
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${ARGS.key}`);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      seen.push(body);
      const index = seen.length;
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return index % 5 === 0
        ? new Response(JSON.stringify({ error: { code: 'rate_limited' } }), { status: 429 })
        : new Response(
            JSON.stringify({ decision: 'serve', reason: null, latency_ms: 3, audit_id: 'aud_x' }),
            { status: 200 },
          );
    };
    const { samples, wallMs } = await runLoad(
      ARGS,
      { app_id: 'app_example', conversation_id: 'conv_demo', turn_id: 'turn_9', messages: [] },
      fetchImpl,
    );
    expect(samples).toHaveLength(25);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(wallMs).toBeGreaterThan(0);
    expect(new Set(seen.map((b) => b['conversation_id'])).size).toBe(25);
    expect(seen.every((b) => b['app_id'] === ARGS.app && b['turn_id'] === 'turn_1')).toBe(true);
    expect(seen.every((b) => Array.isArray(b['messages']))).toBe(true);
    expect(samples.filter((s) => s.status === 200)).toHaveLength(20);
    expect(samples.filter((s) => s.status === 429)).toHaveLength(5);
    expect(samples.find((s) => s.status === 200)).toMatchObject({
      decision: 'serve',
      latency_ms: 3,
    });
    expect(samples.find((s) => s.status === 429)?.decision).toBeUndefined();
  });

  it('records a failed request by its error name instead of throwing', async () => {
    const { samples } = await runLoad({ ...ARGS, requests: 2, concurrency: 1 }, {}, async () => {
      throw new TypeError('fetch failed');
    });
    expect(samples).toEqual([
      { status: 0, ms: expect.any(Number), error: 'TypeError' },
      { status: 0, ms: expect.any(Number), error: 'TypeError' },
    ]);
  });
});
