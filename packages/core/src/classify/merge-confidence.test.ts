import { describe, expect, it } from 'vitest';

import { balanced, commercialMatch, llm, rules, sensitiveMatch, strict } from './merge.fixture.js';
import { mergeClassifications, stagesCorroborate } from './merge.js';

/**
 * The confidence half of mergeClassifications (merge.ts, the CONFIDENCE paragraph). When the
 * rules fired, corroboration between the two stages raises merged confidence to max(rules, llm)
 * and a genuine conflict lowers it to min(rules, llm). Before 2026-09-07 every fired-rules case
 * took the min, so one weak category keyword could veto a certain model and suppress a correct
 * classification as low-confidence (progress.txt, CLASSIFIER-CONFIDENCE).
 */
describe('mergeClassifications: confidence when the rules did not fire', () => {
  it('is the LLM’s: there is nothing to corroborate or contradict', () => {
    for (const confidence of [0.2, 0.55, 0.91]) {
      expect(
        mergeClassifications({ rules: rules(), llm: llm({ confidence }), policy: strict })
          .confidence,
      ).toBe(confidence);
    }
  });

  it('ignores a single weak rule hint that was not flagged', () => {
    const hint = rules({ sensitive: [sensitiveMatch('health', 'weak', false)] });
    expect(
      mergeClassifications({ rules: hint, llm: llm({ confidence: 0.9 }), policy: strict })
        .confidence,
    ).toBe(0.9);
  });
});

describe('mergeClassifications: confidence when the stages CONFLICT', () => {
  it('takes min when the rules category is disjoint from the LLM categories', () => {
    const fired = rules({
      commercial: [commercialMatch('software.devtools.database')],
      commercial_intent: 0.2,
      confidence: 0.45,
    });
    const answer = llm({
      commercial_intent: 0.9,
      categories: ['software.devtools.hosting'],
      confidence: 0.9,
    });
    expect(stagesCorroborate(fired, answer)).toBe(false);
    const merged = mergeClassifications({ rules: fired, llm: answer, policy: strict });
    expect(merged.confidence).toBe(0.45);
    expect(merged.categories).toEqual(['software.devtools.hosting']);
    expect(merged.commercial_intent).toBe(0.9);
  });

  it('takes min when the rules flagged a sensitive category the LLM did not', () => {
    const fired = rules({ sensitive: [sensitiveMatch('health', 'weak')], confidence: 0.75 });
    expect(stagesCorroborate(fired, llm({ sensitive: [] }))).toBe(false);
    expect(
      mergeClassifications({ rules: fired, llm: llm({ confidence: 0.9 }), policy: strict })
        .confidence,
    ).toBe(0.75);
    expect(
      mergeClassifications({ rules: fired, llm: llm({ confidence: 0.6 }), policy: strict })
        .confidence,
    ).toBe(0.6);
  });

  it('takes min when only one of two rule-flagged sensitive categories was confirmed', () => {
    const fired = rules({
      sensitive: [sensitiveMatch('health', 'weak'), sensitiveMatch('finance', 'weak')],
      confidence: 0.75,
    });
    const answer = llm({ sensitive: ['health'], confidence: 0.9 });
    expect(stagesCorroborate(fired, answer)).toBe(false);
    expect(mergeClassifications({ rules: fired, llm: answer, policy: strict }).confidence).toBe(
      0.75,
    );
  });

  it('does not let a confirmed sensitive flag excuse a disjoint category', () => {
    // Both halves of stagesCorroborate have to hold. The LLM confirmed `health`, but the rules
    // also matched a commercial category it does not share, so the stages still conflict.
    const fired = rules({
      sensitive: [sensitiveMatch('health', 'weak')],
      commercial: [commercialMatch('travel.hotels')],
      confidence: 0.75,
    });
    const answer = llm({ sensitive: ['health'], categories: ['food.delivery'], confidence: 0.95 });
    expect(stagesCorroborate(fired, answer)).toBe(false);
    expect(mergeClassifications({ rules: fired, llm: answer, policy: strict }).confidence).toBe(
      0.75,
    );
  });
});

describe('mergeClassifications: confidence when the stages CORROBORATE', () => {
  it('takes max when the rules and the LLM name the same category', () => {
    // The CLASSIFIER-CONFIDENCE regression in miniature: a weak keyword match (0.6) must not
    // veto a certain model (0.9). Agreement is evidence, so the merge takes the higher number.
    const fired = rules({
      commercial: [commercialMatch('software.devtools.observability')],
      commercial_intent: 0.2,
      confidence: 0.6,
    });
    const answer = llm({
      commercial_intent: 0.9,
      categories: ['software.devtools.observability'],
      confidence: 0.9,
    });
    expect(stagesCorroborate(fired, answer)).toBe(true);
    expect(mergeClassifications({ rules: fired, llm: answer, policy: strict }).confidence).toBe(
      0.9,
    );
  });

  it('needs only one shared category out of several', () => {
    const fired = rules({
      commercial: [commercialMatch('travel.hotels')],
      confidence: 0.6,
    });
    const answer = llm({ categories: ['travel.flights', 'travel.hotels'], confidence: 0.88 });
    expect(stagesCorroborate(fired, answer)).toBe(true);
    expect(mergeClassifications({ rules: fired, llm: answer, policy: strict }).confidence).toBe(
      0.88,
    );
  });

  it('takes max when the LLM is the less certain of the two', () => {
    const fired = rules({ commercial: [commercialMatch('travel.hotels')], confidence: 0.95 });
    const answer = llm({ categories: ['travel.hotels'], confidence: 0.55 });
    expect(mergeClassifications({ rules: fired, llm: answer, policy: strict }).confidence).toBe(
      0.95,
    );
  });

  it('raises confidence on a sensitive category both stages flagged, and still caps the intent', () => {
    const fired = rules({ sensitive: [sensitiveMatch('health', 'weak')], confidence: 0.75 });
    const answer = llm({ sensitive: ['health'], commercial_intent: 0.95, confidence: 0.6 });
    expect(stagesCorroborate(fired, answer)).toBe(true);
    const merged = mergeClassifications({ rules: fired, llm: answer, policy: strict });
    expect(merged.confidence).toBe(0.75);
    // Confidence went UP and the flag and the cap are untouched by that.
    expect(merged.sensitive).toEqual(['health']);
    expect(merged.commercial_intent).toBe(0.2);
  });
});

describe('mergeClassifications: the confidence rule is safe by construction', () => {
  it('cannot change the sensitive list or the capped intent, in either detection mode', () => {
    // mergeSensitive reads llm.confidence, never the merged value, so sweeping the rules
    // confidence across the whole range moves `confidence` and nothing else. This is why
    // raising confidence cannot make a flagged turn servable.
    const answer = llm({ sensitive: ['health'], commercial_intent: 0.95, confidence: 0.8 });
    for (const policy of [strict, balanced]) {
      const merged = [0, 0.3, 0.6, 0.75, 0.95].map((confidence) =>
        mergeClassifications({
          rules: rules({
            sensitive: [sensitiveMatch('health', 'weak')],
            commercial: [commercialMatch('shopping.home')],
            confidence,
          }),
          llm: answer,
          policy,
        }),
      );
      for (const result of merged) {
        expect(result.sensitive).toEqual(['health']);
        expect(result.commercial_intent).toBe(0.2);
      }
      // Disjoint categories (shopping.home versus the LLM's `general`), so every one is a min.
      expect(merged.map((result) => result.confidence)).toEqual([0, 0.3, 0.6, 0.75, 0.8]);
    }
  });

  it('never drops self_harm, whichever way the confidences fall', () => {
    const answer = llm({ sensitive: ['self_harm'], commercial_intent: 0.95, confidence: 0.1 });
    for (const policy of [strict, balanced]) {
      for (const confidence of [0, 0.6, 0.95]) {
        const merged = mergeClassifications({
          rules: rules({ commercial: [commercialMatch('shopping.home')], confidence }),
          llm: answer,
          policy,
        });
        expect(merged.sensitive).toEqual(['self_harm']);
        expect(merged.commercial_intent).toBe(0);
      }
    }
  });
});
