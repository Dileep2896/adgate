import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenAiCompatibleClassifier } from './openai.js';
import type { LlmClassifierConfig, LlmFetch, LlmFetchResponse } from './types.js';

/**
 * Failure paths of the OpenAI compatible client. Every test injects a fake fetch; globalThis.fetch
 * is stubbed to reject so an accidental real request fails loudly instead of touching the network.
 */
const config = (
  fetch: LlmFetch,
  extra: Partial<LlmClassifierConfig> = {},
): LlmClassifierConfig => ({
  baseUrl: 'https://llm.example/v1',
  apiKey: 'sk-test',
  model: 'tiny-classifier',
  fetch,
  ...extra,
});

const response = (body: string, status = 200): LlmFetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});
const completion = (content: unknown, status = 200) =>
  response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), status);
const abortError = () =>
  Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
/** Behaves like undici: settles only when the signal aborts. */
const hanging: LlmFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
const validContent = JSON.stringify({
  commercial_intent: 0.8,
  categories: ['software.security'],
  sensitive: [],
  confidence: 0.9,
});

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('unit tests must not touch the network')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OpenAiCompatibleClassifier timeout', () => {
  it('returns { ok: false, reason: timeout } after the default 400 ms without throwing', async () => {
    vi.useFakeTimers();
    const fetchFake = vi.fn(hanging);
    const classifier = new OpenAiCompatibleClassifier(config(fetchFake));
    let settled = false;
    const pending = classifier.classify('best vpn for public wifi').then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(399);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(result.latency_ms).toBeGreaterThanOrEqual(400);
    expect(fetchFake).toHaveBeenCalledTimes(1);
    expect(fetchFake.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });

  it('honours a configured timeoutMs', async () => {
    vi.useFakeTimers();
    const classifier = new OpenAiCompatibleClassifier(config(hanging, { timeoutMs: 50 }));
    const pending = classifier.classify('x');
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({ ok: false, reason: 'timeout', latency_ms: 50 });
  });

  it('still times out when the fetch ignores the abort signal and never settles', async () => {
    vi.useFakeTimers();
    const never: LlmFetch = () => new Promise(() => undefined);
    const classifier = new OpenAiCompatibleClassifier(config(never, { timeoutMs: 100 }));
    const pending = classifier.classify('x');
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('times out while reading a slow body, not only while waiting for headers', async () => {
    vi.useFakeTimers();
    const slowBody: LlmFetch = async (_url, init) => ({
      ok: true,
      status: 200,
      text: () =>
        new Promise<string>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
    });
    const classifier = new OpenAiCompatibleClassifier(config(slowBody));
    const pending = classifier.classify('x');
    await vi.advanceTimersByTimeAsync(400);
    expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
  });
});

describe('OpenAiCompatibleClassifier parse and invalid', () => {
  it('malformed JSON in the model content is reason parse', async () => {
    const classifier = new OpenAiCompatibleClassifier(config(async () => completion('not json')));
    const result = await classifier.classify('x');
    expect(result).toMatchObject({ ok: false, reason: 'parse' });
  });

  it('a body that is not JSON or has no choices[0].message.content is reason parse', async () => {
    for (const body of ['<html>gateway</html>', '{}', '{"choices":[]}', '{"choices":[{}]}']) {
      const classifier = new OpenAiCompatibleClassifier(config(async () => response(body)));
      expect(await classifier.classify('x'), body).toMatchObject({ ok: false, reason: 'parse' });
    }
    const nullContent = new OpenAiCompatibleClassifier(config(async () => completion(null)));
    expect(await nullContent.classify('x')).toMatchObject({ ok: false, reason: 'parse' });
  });

  it('well-formed JSON that fails the LlmOutput schema is reason invalid', async () => {
    const bad = JSON.stringify({ commercial_intent: 'high', categories: [], sensitive: [] });
    const classifier = new OpenAiCompatibleClassifier(config(async () => completion(bad)));
    const result = await classifier.classify('x');
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    if (!result.ok) {
      expect(result.detail).toContain('confidence');
    }
  });
});

describe('OpenAiCompatibleClassifier http and network', () => {
  it('a non-2xx status is reason http with the status in detail', async () => {
    for (const status of [400, 401, 429, 500, 503]) {
      const classifier = new OpenAiCompatibleClassifier(
        config(async () => completion(validContent, status)),
      );
      expect(await classifier.classify('x')).toMatchObject({
        ok: false,
        reason: 'http',
        detail: `HTTP ${status}`,
      });
    }
  });

  it('a rejected fetch is reason network with the error name and message', async () => {
    const classifier = new OpenAiCompatibleClassifier(
      config(() => Promise.reject(new TypeError('fetch failed'))),
    );
    expect(await classifier.classify('x')).toMatchObject({
      ok: false,
      reason: 'network',
      detail: 'TypeError: fetch failed',
    });
  });

  it('a fetch that throws synchronously or a body read that rejects is reason network', async () => {
    const throwing = new OpenAiCompatibleClassifier(
      config(() => {
        throw new Error('boom');
      }),
    );
    expect(await throwing.classify('x')).toMatchObject({ ok: false, reason: 'network' });

    const badBody = new OpenAiCompatibleClassifier(
      config(async () => ({ ok: true, status: 200, text: () => Promise.reject(new Error('eof')) })),
    );
    expect(await badBody.classify('x')).toMatchObject({ ok: false, reason: 'network' });
  });

  it('non-Error rejections still produce a typed network failure', async () => {
    const classifier = new OpenAiCompatibleClassifier(config(() => Promise.reject('nope')));
    expect(await classifier.classify('x')).toMatchObject({ ok: false, reason: 'network' });
  });

  it('uses globalThis.fetch when none is injected (stubbed here, so no network)', async () => {
    const classifier = new OpenAiCompatibleClassifier({
      baseUrl: 'https://llm.example/v1',
      apiKey: 'sk-test',
      model: 'tiny-classifier',
    });
    expect(await classifier.classify('x')).toMatchObject({
      ok: false,
      reason: 'network',
      detail: 'Error: unit tests must not touch the network',
    });
  });
});

describe('OpenAiCompatibleClassifier external abort', () => {
  it('a signal aborted before the call returns aborted without calling fetch', async () => {
    const fetchFake = vi.fn(hanging);
    const classifier = new OpenAiCompatibleClassifier(config(fetchFake));
    const controller = new AbortController();
    controller.abort();
    const result = await classifier.classify('x', { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, reason: 'aborted', latency_ms: 0 });
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it('a signal aborted mid-flight returns aborted, not timeout', async () => {
    vi.useFakeTimers();
    const fetchFake = vi.fn(hanging);
    const classifier = new OpenAiCompatibleClassifier(config(fetchFake));
    const controller = new AbortController();
    const pending = classifier.classify('x', { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: 'aborted' });
    expect(fetchFake.mock.calls[0]?.[1].signal.aborted).toBe(true);
    // The internal timer was cleared: advancing past the timeout changes nothing.
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a signal that is never aborted does not interfere with a normal response', async () => {
    const classifier = new OpenAiCompatibleClassifier(config(async () => completion(validContent)));
    const controller = new AbortController();
    const result = await classifier.classify('x', { signal: controller.signal });
    expect(result).toMatchObject({ ok: true });
  });
});
