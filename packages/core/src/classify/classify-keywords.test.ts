import { describe, expect, it } from 'vitest';

import { createLruCache } from './cache.js';
import { classify } from './classify.js';
import { DEVTOOLS, HEALTH, LLM_ANSWER, deps, turn } from './classify.fixture.js';
import { FakeLlmClassifier } from './llm/fake.js';

/**
 * ClassifyOutcome.keywords: the commercial dictionary terms the rules stage matched, as demand
 * keywords (keywordsFromRulesMatches). They come from the keyword lists, never from the
 * message, and they are present on every path, the cache hit included, so a warm cache ranks
 * creatives exactly like a cold one.
 */
describe('classify: keywords for demand', () => {
  it('lists the matched commercial dictionary terms on the merged path', async () => {
    const outcome = await classify(DEVTOOLS, deps());
    expect(outcome.source).toBe('merged');
    expect(outcome.keywords).toEqual(['postgres hosting', 'postgres', 'hosting']);
  });

  it('keeps the keywords on a cache hit and on the rules-only fallback', async () => {
    const cache = createLruCache();
    const llm = new FakeLlmClassifier(LLM_ANSWER);
    const first = await classify(DEVTOOLS, deps({ llm, cache }));
    const second = await classify(DEVTOOLS, deps({ llm, cache }));
    expect(second.source).toBe('cache');
    expect(second.keywords).toEqual(first.keywords);
    expect(llm.callCount).toBe(1);

    const fallback = await classify(DEVTOOLS, deps({ llm: null, cache: undefined }));
    expect(fallback.source).toBe('rules_fallback');
    expect(fallback.keywords).toEqual(first.keywords);
  });

  it('never carries message text: a sensitive short circuit and unknown words yield none', async () => {
    const health = await classify(HEALTH, deps());
    expect(health.source).toBe('rules_short_circuit');
    expect(health.keywords).toEqual([]);

    const unknown = await classify(turn('zqxv wibble frobnicate'), deps({ llm: null }));
    expect(unknown.keywords).toEqual([]);
    const joined = JSON.stringify(unknown);
    for (const word of ['zqxv', 'wibble', 'frobnicate']) {
      expect(joined).not.toContain(word);
    }
  });

  it('is an empty list when the input cannot be prepared', async () => {
    const outcome = await classify({ messages: 42 as never }, deps({ llm: null }));
    expect(outcome.classification.confidence).toBe(0);
    expect(outcome.keywords).toEqual([]);
  });
});
