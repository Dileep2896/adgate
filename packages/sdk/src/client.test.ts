import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClient, DEFAULT_TIMEOUT_MS } from './client.js';
import { CLIENT_FAILURE_PROMPT_VERSION } from './hash.js';
import {
  API_KEY,
  AUDIT_ID,
  BASE_URL,
  deafFetch,
  fakeFetch,
  fakeLogger,
  hangingFetch,
  headerOf,
  jsonResponse,
  REQUEST,
  SERVE_BODY,
  SUPPRESS_BODY,
  textResponse,
} from './test-support.js';
import type { EvaluateResult } from './types.js';

/** What every client-side failure must look like (docs/api.md: fail closed, never throw). */
const expectFailClosed = (result: EvaluateResult) => {
  expect(result.decision).toBe('suppress');
  expect(result.reason).toBe('error');
  expect(result.creative).toBeNull();
  expect(result.audit_id).toBeNull();
  expect(result.classification).toEqual({
    commercial_intent: 0,
    categories: ['general'],
    sensitive: [],
    confidence: 0,
    method: 'rules',
    prompt_version: CLIENT_FAILURE_PROMPT_VERSION,
  });
  expect(Number.isInteger(result.latency_ms)).toBe(true);
  expect(result.latency_ms).toBeGreaterThanOrEqual(0);
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createClient', () => {
  it('rejects a missing api key, base url or a non-positive timeout at construction time', () => {
    expect(() => createClient({ apiKey: '', baseUrl: BASE_URL })).toThrow(TypeError);
    expect(() => createClient({ apiKey: API_KEY, baseUrl: '' })).toThrow(TypeError);
    expect(() => createClient({ apiKey: API_KEY, baseUrl: BASE_URL, timeoutMs: 0 })).toThrow(
      TypeError,
    );
    expect(() => createClient({ apiKey: API_KEY, baseUrl: BASE_URL, timeoutMs: NaN })).toThrow(
      TypeError,
    );
    expect(() => createClient(undefined as never)).toThrow(TypeError);
  });

  it('returns evaluate, attest and track', () => {
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL });
    expect(Object.keys(client).sort()).toEqual(['attest', 'evaluate', 'track']);
  });

  it('falls back to the platform fetch when none is injected', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, SUPPRESS_BODY));
    vi.stubGlobal('fetch', fetch);
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL });
    const result = await client.evaluate(REQUEST);
    expect(calls).toHaveLength(1);
    expect(result.audit_id).toBe(AUDIT_ID);
  });
});

describe('evaluate: the happy path', () => {
  it('passes a valid serve body through untouched, with its audit_id and no error', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, SERVE_BODY));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });

    const result = await client.evaluate(REQUEST);

    expect(result).toEqual(SERVE_BODY);
    expect(result.error).toBeUndefined();
    expect(result.audit_id).toBe(AUDIT_ID);
    expect(calls).toHaveLength(1);
  });

  it('passes a suppress body through too (the gateway decided, not the client)', async () => {
    const { fetch } = fakeFetch(() => jsonResponse(200, SUPPRESS_BODY));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    const result = await client.evaluate(REQUEST);
    expect(result).toEqual(SUPPRESS_BODY);
    expect(result.error).toBeUndefined();
  });

  it('POSTs the request as JSON to <baseUrl>/v1/evaluate with the bearer key', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, SERVE_BODY));
    const client = createClient({ apiKey: API_KEY, baseUrl: `${BASE_URL}///`, fetch });

    await client.evaluate(REQUEST);

    const [call] = calls;
    expect(call?.url).toBe(`${BASE_URL}/v1/evaluate`);
    expect(call?.init.method).toBe('POST');
    expect(headerOf(call!, 'authorization')).toBe(`Bearer ${API_KEY}`);
    expect(headerOf(call!, 'content-type')).toBe('application/json');
    expect(JSON.parse(call!.init.body)).toEqual(REQUEST);
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not warn on success', async () => {
    const { logger, warnings } = fakeLogger();
    const { fetch } = fakeFetch(() => jsonResponse(200, SERVE_BODY));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch, logger });
    await client.evaluate(REQUEST);
    expect(warnings).toEqual([]);
  });
});

describe('evaluate: never rejects', () => {
  it('resolves to suppress/error kind network when fetch rejects', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });

    const result = await client.evaluate(REQUEST);

    expectFailClosed(result);
    expect(result.error).toEqual({ kind: 'network' });
  });

  it('resolves to network when the body stream fails after the headers arrived', async () => {
    const { fetch } = fakeFetch(() => ({
      ok: true,
      status: 200,
      text: () => Promise.reject(new Error('socket hang up')),
    }));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    const result = await client.evaluate(REQUEST);
    expectFailClosed(result);
    expect(result.error).toEqual({ kind: 'network' });
  });

  it('resolves to network when fetch throws synchronously or is missing', async () => {
    const throwing = () => {
      throw new Error('boom');
    };
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: throwing });
    expect((await client.evaluate(REQUEST)).error).toEqual({ kind: 'network' });

    vi.stubGlobal('fetch', undefined);
    const noFetch = createClient({ apiKey: API_KEY, baseUrl: BASE_URL });
    expect((await noFetch.evaluate(REQUEST)).error).toEqual({ kind: 'network' });
  });

  it('resolves to network when the request body cannot be serialised', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, SERVE_BODY));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    const cyclic: Record<string, unknown> = { ...REQUEST };
    cyclic['self'] = cyclic;
    const result = await client.evaluate(cyclic as never);
    expectFailClosed(result);
    expect(result.error).toEqual({ kind: 'network' });
    expect(calls).toHaveLength(0);
  });

  it('times out with its own abort signal fired when fetch never answers', async () => {
    vi.useFakeTimers();
    const { fetch, calls } = hangingFetch();
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });

    const pending = client.evaluate(REQUEST);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(calls[0]?.init.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(calls[0]?.init.signal.aborted).toBe(true);
    expectFailClosed(result);
    expect(result.error).toEqual({ kind: 'timeout' });
    expect(result.latency_ms).toBe(DEFAULT_TIMEOUT_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out even when the transport ignores the abort signal', async () => {
    vi.useFakeTimers();
    const { fetch, calls } = deafFetch();
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch, timeoutMs: 250 });

    const pending = client.evaluate(REQUEST);
    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;

    expect(calls[0]?.init.signal.aborted).toBe(true);
    expect(result.error).toEqual({ kind: 'timeout' });
    expect(result.latency_ms).toBe(250);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer after a normal answer', async () => {
    vi.useFakeTimers();
    const { fetch } = fakeFetch(() => jsonResponse(200, SERVE_BODY));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    await client.evaluate(REQUEST);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves to invalid_response for a non-JSON body', async () => {
    const { fetch } = fakeFetch(() => textResponse(200, '<html>gateway down</html>'));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    const result = await client.evaluate(REQUEST);
    expectFailClosed(result);
    expect(result.error).toEqual({ kind: 'invalid_response', status: 200 });
  });

  it.each([
    ['an empty body', ''],
    ['a JSON string', JSON.stringify('serve')],
    ['a JSON array', JSON.stringify([SERVE_BODY])],
    ['an unknown decision', JSON.stringify({ ...SERVE_BODY, decision: 'maybe' })],
    ['a missing audit_id', JSON.stringify({ ...SERVE_BODY, audit_id: undefined })],
    ['a numeric audit_id', JSON.stringify({ ...SERVE_BODY, audit_id: 7 })],
    ['a serve without a creative', JSON.stringify({ ...SERVE_BODY, creative: null })],
    ['a serve with a reason', JSON.stringify({ ...SERVE_BODY, reason: 'no_fill' })],
    [
      'a creative missing its url',
      JSON.stringify({ ...SERVE_BODY, creative: { ...SERVE_BODY.creative, url: undefined } }),
    ],
    [
      'a suppress with a creative',
      JSON.stringify({ ...SUPPRESS_BODY, creative: SERVE_BODY.creative }),
    ],
    ['a suppress without a reason', JSON.stringify({ ...SUPPRESS_BODY, reason: null })],
    ['a missing classification', JSON.stringify({ ...SERVE_BODY, classification: undefined })],
    [
      'a classification without categories',
      JSON.stringify({
        ...SERVE_BODY,
        classification: { ...SERVE_BODY.classification, categories: 'x' },
      }),
    ],
    ['a missing latency', JSON.stringify({ ...SERVE_BODY, latency_ms: undefined })],
  ])('resolves to invalid_response for %s', async (_name, text) => {
    const { fetch } = fakeFetch(() => textResponse(200, text));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    const result = await client.evaluate(REQUEST);
    expectFailClosed(result);
    expect(result.error).toEqual({ kind: 'invalid_response', status: 200 });
  });

  it.each([400, 401, 403, 413, 429, 500, 503])(
    'maps HTTP %i to error kind http with the status',
    async (status) => {
      const { fetch } = fakeFetch(() =>
        jsonResponse(status, { error: { code: 'whatever', message: 'nope' } }),
      );
      const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
      const result = await client.evaluate(REQUEST);
      expectFailClosed(result);
      expect(result.error).toEqual({ kind: 'http', status });
    },
  );

  it('resolves to aborted when the caller aborts mid-flight', async () => {
    const { fetch, calls } = hangingFetch();
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    const controller = new AbortController();

    const pending = client.evaluate(REQUEST, { signal: controller.signal });
    controller.abort();
    const result = await pending;

    expect(calls[0]?.init.signal.aborted).toBe(true);
    expectFailClosed(result);
    expect(result.error).toEqual({ kind: 'aborted' });
  });

  it('resolves to aborted without calling fetch when the signal is already aborted', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, SERVE_BODY));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });
    const result = await client.evaluate(REQUEST, { signal: AbortSignal.abort() });
    expect(calls).toHaveLength(0);
    expect(result.error).toEqual({ kind: 'aborted' });
  });
});
