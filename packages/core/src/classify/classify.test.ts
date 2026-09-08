import { Classification, type Message } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { classifyCacheKey, createLruCache } from './cache.js';
import { classify } from './classify.js';
import {
  BALANCED,
  DEVTOOLS,
  GENERAL,
  HEALTH,
  LLM_ANSWER,
  SELF_HARM,
  STRICT,
  deps,
  rulesOnly,
} from './classify.fixture.js';
import { FakeLlmClassifier, fakeLlmSuccess } from './llm/fake.js';
import { PROMPT_VERSION } from './llm/prompt.js';
import { prepareText } from './prepare.js';
import { RULES_VERSION } from './rules/version.js';
import type { ClassifyInput } from './types.js';

describe('classify: merged path', () => {
  it('runs rules then the LLM on the prepared text, merges, and caches the result', async () => {
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const cache = createLruCache();
    const outcome = await classify(DEVTOOLS, deps({ llm, cache }));

    expect(outcome.source).toBe('merged');
    expect(outcome.llm_failure).toBeUndefined();
    expect(outcome.classification).toEqual({
      commercial_intent: 0.84,
      categories: ['software.devtools.database'],
      sensitive: [],
      // The rules matched software.devtools.database at 0.95 and the LLM named the same
      // category, so the stages corroborate and the merge takes max(0.95, 0.91).
      confidence: 0.95,
      method: 'llm',
      prompt_version: PROMPT_VERSION,
    });
    expect(llm.calls).toEqual([prepareText(DEVTOOLS).text]);
    expect(llm.calls[0]).toMatch(/^user: which postgres hosting/);
    expect(outcome.cache_key).toBe(classifyCacheKey(prepareText(DEVTOOLS).text, STRICT));
    expect(cache.get(outcome.cache_key)).toEqual(outcome.classification);
    expect(Classification.parse(outcome.classification)).toEqual(outcome.classification);
    expect(outcome.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('serves a cache hit with method cached and skips the LLM', async () => {
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const cache = createLruCache();
    const first = await classify(DEVTOOLS, deps({ llm, cache }));
    const second = await classify(DEVTOOLS, deps({ llm, cache }));

    expect(second.source).toBe('cache');
    expect(second.classification).toEqual({ ...first.classification, method: 'cached' });
    expect(second.cache_key).toBe(first.cache_key);
    expect(llm.callCount).toBe(1);
    expect(Classification.parse(second.classification).method).toBe('cached');
  });

  it('hands out copies so a caller mutating a result cannot poison the cache', async () => {
    const cache = createLruCache();
    const first = await classify(DEVTOOLS, deps({ cache }));
    first.classification.categories.push('general');
    first.classification.sensitive.push('adult');
    const second = await classify(DEVTOOLS, deps({ cache }));
    expect(second.classification.categories).toEqual(['software.devtools.database']);
    expect(second.classification.sensitive).toEqual([]);
    second.classification.sensitive.push('adult');
    const third = await classify(DEVTOOLS, deps({ cache }));
    expect(third.classification.sensitive).toEqual([]);
  });

  it('works without a cache and accepts context_summary as input', async () => {
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const input: ClassifyInput = { context_summary: 'user compares managed postgres providers' };
    const a = await classify(input, deps({ llm, cache: undefined }));
    const b = await classify(input, deps({ llm, cache: undefined }));
    expect(a.source).toBe('merged');
    expect(b.source).toBe('merged');
    expect(llm.calls).toEqual([input.context_summary, input.context_summary]);
  });

  it('accepts the EvaluateRequest message shape and never shows the LLM a system prompt', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'which postgres hosting should I use for a side project' },
    ];
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const outcome = await classify({ messages }, deps({ llm }));
    expect(outcome.source).toBe('merged');
    expect(llm.calls).toEqual(['user: which postgres hosting should I use for a side project']);
  });

  it('applies sensitive_detection at merge time and keys the cache by policy', async () => {
    const llm = new FakeLlmClassifier(
      fakeLlmSuccess({ sensitive: ['finance'], confidence: 0.6, commercial_intent: 0.9 }),
    );
    const cache = createLruCache();
    const strict = await classify(GENERAL, deps({ llm, cache, policy: STRICT }));
    const balanced = await classify(GENERAL, deps({ llm, cache, policy: BALANCED }));

    expect(strict.classification.sensitive).toEqual(['finance']);
    expect(strict.classification.commercial_intent).toBe(0.2);
    expect(balanced.classification.sensitive).toEqual([]);
    expect(balanced.classification.commercial_intent).toBe(0.9);
    expect(strict.cache_key).not.toBe(balanced.cache_key);
    expect(llm.callCount).toBe(2);
  });

  it('reports latency from the injected clock', async () => {
    let t = 1_000;
    const now = () => {
      const value = t;
      t += 42;
      return value;
    };
    const outcome = await classify(DEVTOOLS, deps({ now }));
    expect(outcome.latency_ms).toBe(42);
  });
});

describe('classify: rules short circuit', () => {
  it('returns the rules classification without calling the LLM on a strong sensitive hit', async () => {
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const cache = createLruCache();
    const outcome = await classify(HEALTH, deps({ llm, cache }));

    expect(outcome.source).toBe('rules_short_circuit');
    expect(outcome.llm_failure).toBeUndefined();
    expect(outcome.classification).toEqual(rulesOnly(HEALTH));
    expect(outcome.classification.method).toBe('rules');
    expect(outcome.classification.prompt_version).toBe(RULES_VERSION);
    expect(outcome.classification.sensitive).toContain('health');
    expect(outcome.classification.commercial_intent).toBeLessThanOrEqual(0.2);
    expect(outcome.classification.confidence).toBeGreaterThanOrEqual(0.9);
    expect(outcome.classification).not.toHaveProperty('matches');
    expect(llm.callCount).toBe(0);

    const again = await classify(HEALTH, deps({ llm, cache }));
    expect(again.source).toBe('cache');
    expect(again.classification.method).toBe('cached');
    expect(again.classification.sensitive).toContain('health');
    expect(llm.callCount).toBe(0);
  });

  it('short-circuits under balanced detection too, and self_harm gets intent 0', async () => {
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const outcome = await classify(SELF_HARM, deps({ llm, policy: BALANCED }));
    expect(outcome.source).toBe('rules_short_circuit');
    expect(outcome.classification.sensitive).toEqual(['self_harm']);
    expect(outcome.classification.commercial_intent).toBe(0);
    expect(llm.callCount).toBe(0);
  });
});
