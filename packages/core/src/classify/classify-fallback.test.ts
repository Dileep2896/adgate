import { Classification } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { classifyCacheKey, createLruCache } from './cache.js';
import { classify, failClosedClassification } from './classify.js';
import { DEVTOOLS, GENERAL, LLM_ANSWER, STRICT, deps, rulesOnly } from './classify.fixture.js';
import { FakeLlmClassifier, fakeLlmFailure } from './llm/fake.js';
import type { FakeLlmScript } from './llm/fake.js';
import { prepareText } from './prepare.js';
import { classifyByRules } from './rules/classify.js';
import { RULES_VERSION } from './rules/version.js';
import type { ClassifyCache, ClassifyInput } from './types.js';

describe('classify: LLM failure falls back to rules', () => {
  const modes: [string, FakeLlmScript, string][] = [
    ['timeout', 'timeout', 'timeout'],
    ['parse', 'parse', 'parse'],
    ['throw', 'throw', 'thrown'],
    ['invalid', fakeLlmFailure('invalid'), 'invalid'],
    ['http', fakeLlmFailure('http', 5, 'HTTP 500'), 'http'],
    ['network', fakeLlmFailure('network'), 'network'],
    ['aborted', fakeLlmFailure('aborted'), 'aborted'],
  ];

  it.each(modes)(
    '%s: method rules, rules confidence, not cached',
    async (_name, script, reason) => {
      const llm = new FakeLlmClassifier(script);
      const cache = createLruCache();
      const outcome = await classify(DEVTOOLS, deps({ llm, cache }));

      expect(outcome.source).toBe('rules_fallback');
      expect(outcome.llm_failure).toBe(reason);
      expect(outcome.classification).toEqual(rulesOnly(DEVTOOLS));
      expect(outcome.classification.method).toBe('rules');
      expect(outcome.classification.confidence).toBe(
        classifyByRules(prepareText(DEVTOOLS)).confidence,
      );
      expect(outcome.classification.prompt_version).toBe(RULES_VERSION);
      expect(cache.size).toBe(0);

      const again = await classify(DEVTOOLS, deps({ llm, cache }));
      expect(again.source).toBe('rules_fallback');
      expect(llm.callCount).toBe(2);
    },
  );

  it('with no LLM configured returns rules only with llm_failure unavailable, not cached', async () => {
    const cache = createLruCache();
    const outcome = await classify(GENERAL, deps({ llm: null, cache }));
    expect(outcome.source).toBe('rules_fallback');
    expect(outcome.llm_failure).toBe('unavailable');
    expect(outcome.classification).toEqual(rulesOnly(GENERAL));
    expect(outcome.classification.categories).toEqual(['general']);
    expect(cache.size).toBe(0);
  });

  it('skips the LLM when there is nothing to classify', async () => {
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const cache = createLruCache();
    for (const input of [{}, { context_summary: '   ' }, { messages: [] }]) {
      const outcome = await classify(input as ClassifyInput, deps({ llm, cache }));
      expect(outcome.source).toBe('rules_fallback');
      expect(outcome.llm_failure).toBe('empty_input');
      expect(outcome.classification.method).toBe('rules');
      expect(outcome.classification.confidence).toBeLessThan(0.7);
      expect(outcome.classification.commercial_intent).toBe(0);
    }
    expect(llm.callCount).toBe(0);
    expect(cache.size).toBe(0);
  });

  it('forwards the caller signal to the LLM', async () => {
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const controller = new AbortController();
    controller.abort();
    const outcome = await classify(DEVTOOLS, deps({ llm, signal: controller.signal }));
    expect(outcome.source).toBe('rules_fallback');
    expect(outcome.llm_failure).toBe('aborted');
    expect(llm.callCount).toBe(1);
  });
});

describe('classify: never throws', () => {
  const broken = (mode: 'get' | 'set'): ClassifyCache => ({
    get: () => {
      if (mode === 'get') {
        throw new Error('cache down');
      }
      return undefined;
    },
    set: () => {
      if (mode === 'set') {
        throw new Error('cache down');
      }
    },
  });

  it('converts a cache that throws on get into a rules-only result', async () => {
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const outcome = await classify(DEVTOOLS, deps({ llm, cache: broken('get') }));
    expect(outcome.source).toBe('rules_fallback');
    expect(outcome.llm_failure).toBe('thrown');
    expect(outcome.classification).toEqual(rulesOnly(DEVTOOLS));
    expect(outcome.cache_key).toBe(classifyCacheKey(prepareText(DEVTOOLS), STRICT));
    expect(llm.callCount).toBe(0);
  });

  it('converts a cache that throws on set into a rules-only result', async () => {
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const outcome = await classify(DEVTOOLS, deps({ llm, cache: broken('set') }));
    expect(outcome.source).toBe('rules_fallback');
    expect(outcome.llm_failure).toBe('thrown');
    expect(outcome.classification).toEqual(rulesOnly(DEVTOOLS));
    expect(llm.callCount).toBe(1);
  });

  it('converts a synchronously throwing LLM into a rules-only result', async () => {
    const llm = {
      classify: () => {
        throw new TypeError('boom');
      },
    };
    const outcome = await classify(GENERAL, deps({ llm }));
    expect(outcome.source).toBe('rules_fallback');
    expect(outcome.llm_failure).toBe('thrown');
    expect(outcome.classification).toEqual(rulesOnly(GENERAL));
  });

  it('fails closed when the input cannot even be prepared', async () => {
    const broken = [null, { messages: 'nope' }, { messages: { length: 1 } }];
    for (const input of broken) {
      const outcome = await classify(input as unknown as ClassifyInput, deps());
      expect(outcome.source).toBe('rules_fallback');
      expect(outcome.llm_failure).toBe('thrown');
      expect(outcome.classification).toEqual(failClosedClassification());
      expect(outcome.cache_key).toBe('');
    }
  });

  it('fails closed when even the clock throws', async () => {
    const now = () => {
      throw new Error('no clock');
    };
    const outcome = await classify(DEVTOOLS, deps({ now }));
    expect(outcome.classification).toEqual(failClosedClassification());
    expect(outcome.source).toBe('rules_fallback');
    expect(outcome.llm_failure).toBe('thrown');
  });

  it('failClosedClassification is a fresh zeroed rules classification', () => {
    expect(failClosedClassification()).toEqual({
      commercial_intent: 0,
      categories: ['general'],
      sensitive: [],
      confidence: 0,
      method: 'rules',
      prompt_version: RULES_VERSION,
    });
    expect(failClosedClassification()).not.toBe(failClosedClassification());
    expect(Classification.parse(failClosedClassification())).toEqual(failClosedClassification());
  });
});
