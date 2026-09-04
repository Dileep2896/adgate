import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClient } from './client.js';
import {
  API_KEY,
  AUDIT_ID,
  BASE_URL,
  bodyOf,
  deafFetch,
  emptyResponse,
  fakeFetch,
  fakeLogger,
  hangingFetch,
  headerOf,
  jsonResponse,
} from './test-support.js';

const MODEL_OUTPUT =
  'For a side project, a managed Postgres with a free tier is the least hassle.\nStart there.';
const MODEL_OUTPUT_HASH = `sha256:${createHash('sha256').update(MODEL_OUTPUT, 'utf8').digest('hex')}`;

afterEach(() => {
  vi.useRealTimers();
});

describe('attest', () => {
  it('POSTs only the sha256 hash of the model output, never the text', async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(204));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });

    const result = await client.attest(AUDIT_ID, MODEL_OUTPUT);

    expect(result).toEqual({ ok: true, status: 204 });
    const [call] = calls;
    expect(call?.url).toBe(`${BASE_URL}/v1/attest`);
    expect(call?.init.method).toBe('POST');
    expect(headerOf(call!, 'authorization')).toBe(`Bearer ${API_KEY}`);
    expect(headerOf(call!, 'content-type')).toBe('application/json');
    expect(bodyOf(call!)).toEqual({
      audit_id: AUDIT_ID,
      model_output_hash: MODEL_OUTPUT_HASH,
      rendered: true,
    });
    expect(call?.init.body).not.toContain('side project');
    expect(call?.init.body).not.toContain('Start there');
  });

  it('sends rendered: false when asked', async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(204));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    await client.attest(AUDIT_ID, MODEL_OUTPUT, { rendered: false });
    expect(bodyOf(calls[0]!)['rendered']).toBe(false);
  });

  it('hashes the empty answer too', async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(204));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    await client.attest(AUDIT_ID, '');
    expect(bodyOf(calls[0]!)['model_output_hash']).toBe(
      `sha256:${createHash('sha256').update('').digest('hex')}`,
    );
  });

  it.each([404, 409])('swallows HTTP %i as ok false and warns with the status', async (status) => {
    const { logger, warnings } = fakeLogger();
    const { fetch } = fakeFetch(() => jsonResponse(status, { error: { code: 'x', message: 'y' } }));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch, logger });

    const result = await client.attest(AUDIT_ID, MODEL_OUTPUT);

    expect(result).toEqual({ ok: false, status, error: 'http' });
    expect(warnings).toEqual([
      { message: 'adgate attest rejected', data: { audit_id: AUDIT_ID, status } },
    ]);
  });

  it('never rejects on a network failure', async () => {
    const { logger, warnings } = fakeLogger();
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch, logger });

    const result = await client.attest(AUDIT_ID, MODEL_OUTPUT);

    expect(result).toEqual({ ok: false, error: 'network' });
    expect(warnings).toEqual([
      { message: 'adgate attest failed', data: { audit_id: AUDIT_ID, error: 'network' } },
    ]);
  });

  it('times out without rejecting', async () => {
    vi.useFakeTimers();
    const { fetch, calls } = deafFetch();
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch, timeoutMs: 300 });

    const pending = client.attest(AUDIT_ID, MODEL_OUTPUT);
    // The hash resolves through WebCrypto on the real event loop before the request (and its
    // deadline timer) exists; vi.waitFor polls with real timers while fake time stands still.
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(300);

    await expect(pending).resolves.toEqual({ ok: false, error: 'timeout' });
    expect(calls[0]?.init.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours the caller abort signal', async () => {
    const { fetch } = hangingFetch();
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    const controller = new AbortController();
    const pending = client.attest(AUDIT_ID, MODEL_OUTPUT, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ ok: false, error: 'aborted' });
  });

  it('is silent by default: no logger means no output', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { fetch } = fakeFetch(() => jsonResponse(404, { error: { code: 'not_found' } }));
      const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
      await client.attest(AUDIT_ID, MODEL_OUTPUT);
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('track', () => {
  it('POSTs the documented event body with ts defaulting to now in ISO 8601 UTC', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T10:11:12.345Z'));
    const { fetch, calls } = fakeFetch(() => emptyResponse(204));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });

    const result = await client.track(AUDIT_ID, 'impression');

    expect(result).toEqual({ ok: true, status: 204 });
    const [call] = calls;
    expect(call?.url).toBe(`${BASE_URL}/v1/events`);
    expect(call?.init.method).toBe('POST');
    expect(headerOf(call!, 'authorization')).toBe(`Bearer ${API_KEY}`);
    expect(bodyOf(call!)).toEqual({
      audit_id: AUDIT_ID,
      type: 'impression',
      ts: '2026-09-03T10:11:12.345Z',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes an explicit ts and meta through', async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(204));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    await client.track(AUDIT_ID, 'dismiss', {
      ts: '2026-09-02T18:04:11Z',
      meta: { placement: 'sidebar', n: 1 },
    });
    expect(bodyOf(calls[0]!)).toEqual({
      audit_id: AUDIT_ID,
      type: 'dismiss',
      ts: '2026-09-02T18:04:11Z',
      meta: { placement: 'sidebar', n: 1 },
    });
  });

  it.each([404, 403, 400, 429, 500])('never rejects on HTTP %i', async (status) => {
    const { logger, warnings } = fakeLogger();
    const { fetch } = fakeFetch(() => jsonResponse(status, { error: { code: 'x', message: 'y' } }));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch, logger });
    await expect(client.track(AUDIT_ID, 'click')).resolves.toEqual({
      ok: false,
      status,
      error: 'http',
    });
    expect(warnings).toEqual([
      { message: 'adgate track rejected', data: { audit_id: AUDIT_ID, status } },
    ]);
  });

  it('never rejects on a network failure or a timeout', async () => {
    const down = fakeFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: down.fetch });
    await expect(client.track(AUDIT_ID, 'conversion')).resolves.toEqual({
      ok: false,
      error: 'network',
    });

    vi.useFakeTimers();
    const slow = deafFetch();
    const slowClient = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: slow.fetch });
    const pending = slowClient.track(AUDIT_ID, 'conversion');
    await vi.advanceTimersByTimeAsync(800);
    await expect(pending).resolves.toEqual({ ok: false, error: 'timeout' });
  });

  it('honours the caller abort signal', async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(204));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    await expect(
      client.track(AUDIT_ID, 'impression', { signal: AbortSignal.abort() }),
    ).resolves.toEqual({ ok: false, error: 'aborted' });
    expect(calls).toHaveLength(0);
  });
});
