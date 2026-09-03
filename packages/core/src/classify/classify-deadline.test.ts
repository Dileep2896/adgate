import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLruCache } from './cache.js';
import { classify } from './classify.js';
import { DEVTOOLS, LLM_ANSWER, deps, rulesOnly } from './classify.fixture.js';
import { FakeLlmClassifier } from './llm/fake.js';
import { DEFAULT_LLM_TIMEOUT_MS } from './llm/types.js';

/**
 * The orchestrator's own deadline on the LLM stage (deps.timeoutMs). The OpenAI client has a
 * timeout of its own, but classify() must not trust an LlmClassifier implementation to settle:
 * a hanging promise degrades to rules only at the deadline, and the timer never leaks.
 */
afterEach(() => {
  vi.useRealTimers();
});

describe('classify: deadline on the LLM stage', () => {
  it('gives up after deps.timeoutMs with llm_failure timeout, rules only and nothing cached', async () => {
    vi.useFakeTimers();
    const llm = new FakeLlmClassifier('hang');
    const cache = createLruCache();
    let settled = false;
    const pending = classify(DEVTOOLS, deps({ llm, cache, timeoutMs: 100 })).then((outcome) => {
      settled = true;
      return outcome;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await pending;

    expect(outcome.source).toBe('rules_fallback');
    expect(outcome.llm_failure).toBe('timeout');
    expect(outcome.error_name).toBeUndefined();
    expect(outcome.classification).toEqual(rulesOnly(DEVTOOLS));
    expect(outcome.latency_ms).toBe(100);
    expect(llm.callCount).toBe(1);
    expect(cache.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('defaults the deadline to DEFAULT_LLM_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = classify(DEVTOOLS, deps({ llm: new FakeLlmClassifier('hang') })).then(
      (outcome) => {
        settled = true;
        return outcome;
      },
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_LLM_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).llm_failure).toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline timer when the LLM answers in time', async () => {
    vi.useFakeTimers();
    const outcome = await classify(DEVTOOLS, deps({ llm: new FakeLlmClassifier(LLM_ANSWER) }));
    expect(outcome.source).toBe('merged');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline timer when the LLM rejects or is skipped', async () => {
    vi.useFakeTimers();
    const thrown = await classify(DEVTOOLS, deps({ llm: new FakeLlmClassifier('throw') }));
    expect(thrown.llm_failure).toBe('thrown');
    expect(vi.getTimerCount()).toBe(0);
    const skipped = await classify(DEVTOOLS, deps({ llm: null }));
    expect(skipped.llm_failure).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });
});
