import { readFileSync } from 'node:fs';

import { Classification, ClassifyFixture, type ClassifyFixtureCase } from '@adgateio/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeLlmClassifier, fakeLlmFailure, fakeLlmSuccess } from './fake.js';
import { fakeLlmFromFixtures } from './fixtures.js';
import { PROMPT_VERSION } from './prompt.js';
import type { LlmClassifier } from './types.js';

const { cases } = ClassifyFixture.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../../../fixtures/classify-fixtures.json', import.meta.url),
      'utf8',
    ),
  ),
);
const byId = (id: string): ClassifyFixtureCase => {
  const found = cases.find((c) => c.id === id);
  if (!found) {
    throw new Error(`fixture ${id} missing`);
  }
  return found;
};

describe('fakeLlmSuccess and fakeLlmFailure', () => {
  it('build valid results with method llm and PROMPT_VERSION', () => {
    const success = fakeLlmSuccess({ commercial_intent: 0.7, categories: ['travel.hotels'] });
    expect(success).toEqual({
      ok: true,
      classification: {
        commercial_intent: 0.7,
        categories: ['travel.hotels'],
        sensitive: [],
        confidence: 0.9,
        method: 'llm',
        prompt_version: PROMPT_VERSION,
      },
      latency_ms: 5,
    });
    expect(Classification.safeParse(success.classification).success).toBe(true);
    expect(fakeLlmFailure('http', 12, 'HTTP 500')).toEqual({
      ok: false,
      reason: 'http',
      latency_ms: 12,
      detail: 'HTTP 500',
    });
    expect(fakeLlmFailure('timeout')).toEqual({ ok: false, reason: 'timeout', latency_ms: 5 });
  });
});

describe('FakeLlmClassifier', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is an LlmClassifier that returns a fixed result and records every call', async () => {
    const fixed = fakeLlmSuccess({ commercial_intent: 0.3 });
    const fake: LlmClassifier = new FakeLlmClassifier(fixed);
    expect(await fake.classify('one')).toBe(fixed);
    expect(await fake.classify('two')).toBe(fixed);
    const recorder = fake as FakeLlmClassifier;
    expect(recorder.calls).toEqual(['one', 'two']);
    expect(recorder.callCount).toBe(2);
    recorder.reset();
    expect(recorder.callCount).toBe(0);
  });

  it('runs a function script against the text', async () => {
    const fake = new FakeLlmClassifier((text) =>
      text.includes('vpn')
        ? fakeLlmSuccess({ categories: ['software.security'] })
        : fakeLlmFailure('parse'),
    );
    expect(await fake.classify('best vpn')).toMatchObject({
      ok: true,
      classification: { categories: ['software.security'] },
    });
    expect(await fake.classify('hello')).toMatchObject({ ok: false, reason: 'parse' });
  });

  it('timeout and parse modes return the matching typed failure', async () => {
    expect(await new FakeLlmClassifier('timeout').classify('x')).toMatchObject({
      ok: false,
      reason: 'timeout',
      latency_ms: 400,
    });
    expect(await new FakeLlmClassifier('parse').classify('x')).toMatchObject({
      ok: false,
      reason: 'parse',
    });
  });

  it('hang mode never settles, so callers can prove their own deadline fires', async () => {
    vi.useFakeTimers();
    const fake = new FakeLlmClassifier('hang');
    let settled = false;
    void fake.classify('x').then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    expect(fake.calls).toEqual(['x']);
  });

  it('throw mode rejects, so callers can prove they convert throws to rules-only', async () => {
    const fake = new FakeLlmClassifier('throw');
    await expect(fake.classify('x')).rejects.toThrow('FakeLlmClassifier: throw mode');
    expect(fake.calls).toEqual(['x']);
  });

  it('honours an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = new FakeLlmClassifier(fakeLlmSuccess({}));
    expect(await fake.classify('x', { signal: controller.signal })).toMatchObject({
      ok: false,
      reason: 'aborted',
    });
  });
});

describe('fakeLlmFromFixtures', () => {
  const script = fakeLlmFromFixtures(cases);
  const classify = (text: string) => {
    const result = script(text);
    if (!result.ok) {
      throw new Error('fixture script always succeeds');
    }
    return result.classification;
  };

  it('sensitive cases answer with the expected flags, low intent and confidence 0.9', () => {
    for (const c of cases.filter((c) => c.id.startsWith('s'))) {
      const classification = classify(c.text);
      expect(classification.sensitive, c.id).toEqual(c.expect.sensitive);
      expect(classification.commercial_intent, c.id).toBeLessThanOrEqual(0.2);
      expect(classification.confidence).toBe(0.9);
      expect(classification.method).toBe('llm');
      expect(Classification.safeParse(classification).success).toBe(true);
    }
    expect(classify(byId('s027').text).commercial_intent).toBe(0);
  });

  it('serve cases answer with the midpoint intent and every categories_any entry', () => {
    for (const c of cases.filter((c) => c.id.startsWith('c'))) {
      const classification = classify(c.text);
      const { intent_min = 0, intent_max = 1, categories_any } = c.expect;
      expect(classification.commercial_intent, c.id).toBeCloseTo((intent_min + intent_max) / 2, 3);
      expect(classification.categories, c.id).toEqual(categories_any ?? ['general']);
      expect(classification.sensitive).toEqual([]);
    }
    expect(classify(byId('c005').text).categories).toEqual([
      'software.devtools.database',
      'software.devtools.ai',
    ]);
  });

  it('low intent cases stay under their intent_max', () => {
    for (const c of cases.filter((c) => c.id.startsWith('l'))) {
      const classification = classify(c.text);
      expect(classification.commercial_intent, c.id).toBeLessThanOrEqual(c.expect.intent_max ?? 1);
      expect(classification.categories).toEqual(['general']);
    }
  });

  it('matches on normalized text and on a case text embedded in a longer conversation', () => {
    const c007 = byId('c007');
    const expected = classify(c007.text);
    expect(classify('  BEST VPN, for public WiFi!! ')).toEqual(expected);
    expect(classify(`user: hi there\nuser: ${c007.text}\nassistant: sure`)).toEqual(expected);
  });

  it('unknown text gets intent 0.1, general and confidence 0.5', () => {
    expect(classify('completely unrelated text about nothing in the fixtures')).toMatchObject({
      commercial_intent: 0.1,
      categories: ['general'],
      sensitive: [],
      confidence: 0.5,
    });
    expect(classify('')).toMatchObject({ commercial_intent: 0.1, categories: ['general'] });
  });

  it('plugs into FakeLlmClassifier and uses 0.9 intent for bound-less serve cases', async () => {
    const fake = new FakeLlmClassifier(script);
    expect(await fake.classify(byId('c001').text)).toMatchObject({
      ok: true,
      classification: { categories: ['software.devtools.database'] },
    });
    const custom = fakeLlmFromFixtures([
      { id: 'x1', text: 'buy me a robot', expect: { sensitive: [] } },
      { id: 'x2', text: 'weapons talk', expect: { sensitive: ['weapons'] } },
    ]);
    expect(custom('buy me a robot')).toMatchObject({
      classification: { commercial_intent: 0.9, categories: ['general'] },
    });
    expect(custom('weapons talk')).toMatchObject({
      classification: { commercial_intent: 0.1, sensitive: ['weapons'] },
    });
  });
});
