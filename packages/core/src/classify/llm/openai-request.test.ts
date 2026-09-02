import { Classification } from '@adgate/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHAT_COMPLETIONS_PATH,
  OpenAiCompatibleClassifier,
  buildChatCompletionsBody,
  buildChatCompletionsUrl,
} from './openai.js';
import { CLASSIFIER_PROMPT, PROMPT_VERSION } from './prompt.js';
import type { LlmFetch, LlmFetchResponse } from './types.js';

/** Request shape and the happy path. See openai.test.ts for every failure path. */
const completion = (content: string): LlmFetchResponse => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
});
const validContent = JSON.stringify({
  commercial_intent: 0.84,
  categories: ['Software.Devtools.Database', 'not.real'],
  sensitive: ['Health'],
  confidence: 0.91,
});
const make = (fetch: LlmFetch, apiKey = 'sk-test') =>
  new OpenAiCompatibleClassifier({
    baseUrl: 'https://llm.example/v1',
    apiKey,
    model: 'tiny-classifier',
    fetch,
  });

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('unit tests must not touch the network')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatibleClassifier request', () => {
  it('POSTs a chat completion with bearer auth, model, temperature 0 and JSON mode', async () => {
    const fetchFake = vi.fn<LlmFetch>(async () => completion(validContent));
    await make(fetchFake).classify('which postgres hosting should I use');

    expect(fetchFake).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFake.mock.calls[0] as Parameters<LlmFetch>;
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
    expect(JSON.parse(init.body)).toEqual({
      model: 'tiny-classifier',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user', content: 'which postgres hosting should I use' },
      ],
    });
  });

  it('omits the Authorization header when the api key is empty (local endpoints)', async () => {
    const fetchFake = vi.fn<LlmFetch>(async () => completion(validContent));
    await make(fetchFake, '').classify('x');
    const init = fetchFake.mock.calls[0]?.[1] as Parameters<LlmFetch>[1];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('builds the URL from the base URL without doubling slashes', () => {
    expect(CHAT_COMPLETIONS_PATH).toBe('/chat/completions');
    expect(buildChatCompletionsUrl('https://llm.example/v1')).toBe(
      'https://llm.example/v1/chat/completions',
    );
    expect(buildChatCompletionsUrl('https://llm.example/v1/')).toBe(
      'https://llm.example/v1/chat/completions',
    );
    expect(buildChatCompletionsUrl('http://localhost:11434/v1//')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('buildChatCompletionsBody puts the prompt in the system message and the text last', () => {
    const body = buildChatCompletionsBody('m', 'hello');
    expect(body.messages).toEqual([
      { role: 'system', content: CLASSIFIER_PROMPT },
      { role: 'user', content: 'hello' },
    ]);
    expect(body).toMatchObject({
      model: 'm',
      temperature: 0,
      response_format: { type: 'json_object' },
    });
  });
});

describe('OpenAiCompatibleClassifier happy path', () => {
  it('maps a valid response into a Classification with method llm and PROMPT_VERSION', async () => {
    const result = await make(async () => completion(validContent)).classify('x');
    expect(result).toEqual({
      ok: true,
      classification: {
        commercial_intent: 0.84,
        categories: ['software.devtools.database'],
        sensitive: ['health'],
        confidence: 0.91,
        method: 'llm',
        prompt_version: PROMPT_VERSION,
      },
      latency_ms: expect.any(Number),
    });
    if (result.ok) {
      expect(Classification.safeParse(result.classification).success).toBe(true);
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result.latency_ms)).toBe(true);
    }
  });

  it('accepts content wrapped in a markdown fence and clamps out-of-range numbers', async () => {
    const fenced =
      '```json\n' +
      JSON.stringify({ commercial_intent: 1.5, categories: [], sensitive: [], confidence: -1 }) +
      '\n```';
    const result = await make(async () => completion(fenced)).classify('x');
    expect(result).toMatchObject({
      ok: true,
      classification: { commercial_intent: 1, confidence: 0, categories: ['general'] },
    });
  });

  it('makes one request per classify call and keeps calls independent', async () => {
    const fetchFake = vi.fn<LlmFetch>(async () => completion(validContent));
    const classifier = make(fetchFake);
    const [a, b] = await Promise.all([classifier.classify('a'), classifier.classify('b')]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect(fetchFake).toHaveBeenCalledTimes(2);
    const texts = fetchFake.mock.calls.map(
      ([, init]) =>
        (JSON.parse(init.body) as { messages: { content: string }[] }).messages[1]?.content,
    );
    expect(texts.sort()).toEqual(['a', 'b']);
  });
});
