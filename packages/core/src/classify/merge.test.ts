import { Classification } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { PROMPT_VERSION } from './llm/prompt.js';
import { balanced, commercialMatch, llm, rules, sensitiveMatch, strict } from './merge.fixture.js';
import { mergeClassifications, rulesFired, strongSensitiveFlags } from './merge.js';

/**
 * The sensitive-flag and intent-cap half of mergeClassifications. The confidence rule has its
 * own file, merge-confidence.test.ts.
 */
describe('mergeClassifications', () => {
  it('lets the LLM win on categories, intent and confidence when rules found nothing', () => {
    const merged = mergeClassifications({
      rules: rules(),
      llm: llm({
        commercial_intent: 0.84,
        categories: ['software.devtools.database'],
        confidence: 0.91,
      }),
      policy: strict,
    });
    expect(merged).toEqual({
      commercial_intent: 0.84,
      categories: ['software.devtools.database'],
      sensitive: [],
      confidence: 0.91,
      method: 'llm',
      prompt_version: PROMPT_VERSION,
    });
    expect(merged).not.toHaveProperty('matches');
    expect(Classification.parse(merged)).toEqual(merged);
  });

  it('strict: sensitive is the union of rules and LLM flags in taxonomy order, intent capped at 0.2', () => {
    const merged = mergeClassifications({
      rules: rules({ sensitive: [sensitiveMatch('legal', 'weak')], confidence: 0.75 }),
      llm: llm({ sensitive: ['health'], commercial_intent: 0.9, confidence: 0.5 }),
      policy: strict,
    });
    expect(merged.sensitive).toEqual(['health', 'legal']);
    expect(merged.commercial_intent).toBe(0.2);
    expect(merged.confidence).toBe(0.5);
  });

  it('strict: a low-confidence LLM flag still counts (any signal suppresses)', () => {
    const merged = mergeClassifications({
      rules: rules(),
      llm: llm({ sensitive: ['finance'], confidence: 0.2 }),
      policy: strict,
    });
    expect(merged.sensitive).toEqual(['finance']);
  });

  it('ignores a single weak rule hint that was not flagged', () => {
    const hint = rules({ sensitive: [sensitiveMatch('health', 'weak', false)] });
    const merged = mergeClassifications({
      rules: hint,
      llm: llm({ confidence: 0.9 }),
      policy: strict,
    });
    expect(merged.sensitive).toEqual([]);
    expect(merged.confidence).toBe(0.9);
    expect(rulesFired(hint)).toBe(false);
  });

  it('balanced: keeps every flagged rule category, weak pairs included', () => {
    const merged = mergeClassifications({
      rules: rules({
        sensitive: [sensitiveMatch('health', 'weak'), sensitiveMatch('weapons', 'strong')],
        confidence: 0.9,
      }),
      llm: llm({ sensitive: [], confidence: 0.9, commercial_intent: 0.8 }),
      policy: balanced,
    });
    expect(merged.sensitive).toEqual(['health', 'weapons']);
    expect(merged.commercial_intent).toBe(0.2);
  });

  it('balanced: an LLM-only health flag below min_confidence is dropped; strict keeps it', () => {
    const answer = llm({ sensitive: ['health'], confidence: 0.65, commercial_intent: 0.9 });
    const relaxed = mergeClassifications({ rules: rules(), llm: answer, policy: balanced });
    expect(relaxed.sensitive).toEqual([]);
    expect(relaxed.commercial_intent).toBe(0.9);
    const tight = mergeClassifications({ rules: rules(), llm: answer, policy: strict });
    expect(tight.sensitive).toEqual(['health']);
    expect(tight.commercial_intent).toBe(0.2);
  });

  it('never drops self_harm: an LLM-only flag at confidence 0.65 survives balanced detection', () => {
    const answer = llm({
      sensitive: ['self_harm', 'health'],
      confidence: 0.65,
      commercial_intent: 0.9,
    });
    const relaxed = mergeClassifications({ rules: rules(), llm: answer, policy: balanced });
    expect(relaxed.sensitive).toEqual(['self_harm']);
    expect(relaxed.commercial_intent).toBe(0);
    const tight = mergeClassifications({ rules: rules(), llm: answer, policy: strict });
    expect(tight.sensitive).toEqual(['health', 'self_harm']);
    expect(tight.commercial_intent).toBe(0);
  });

  it('balanced: LLM flags count only when the LLM confidence reaches min_confidence', () => {
    const below = mergeClassifications({
      rules: rules(),
      llm: llm({ sensitive: ['finance'], confidence: 0.69, commercial_intent: 0.9 }),
      policy: balanced,
    });
    expect(below.sensitive).toEqual([]);
    expect(below.commercial_intent).toBe(0.9);
    const at = mergeClassifications({
      rules: rules(),
      llm: llm({ sensitive: ['finance'], confidence: 0.7, commercial_intent: 0.9 }),
      policy: balanced,
    });
    expect(at.sensitive).toEqual(['finance']);
    expect(at.commercial_intent).toBe(0.2);
  });

  it('forces commercial_intent to 0 for self_harm and keeps an intent already below the cap', () => {
    const selfHarm = mergeClassifications({
      rules: rules(),
      llm: llm({ sensitive: ['self_harm'], commercial_intent: 0.5 }),
      policy: strict,
    });
    expect(selfHarm.commercial_intent).toBe(0);
    const low = mergeClassifications({
      rules: rules(),
      llm: llm({ sensitive: ['adult'], commercial_intent: 0.1 }),
      policy: strict,
    });
    expect(low.commercial_intent).toBe(0.1);
  });

  it('does not share arrays with its inputs', () => {
    const answer = llm({ categories: ['travel.hotels'], sensitive: ['gambling'] });
    const merged = mergeClassifications({ rules: rules(), llm: answer, policy: strict });
    expect(merged.categories).not.toBe(answer.categories);
    expect(merged.sensitive).not.toBe(answer.sensitive);
  });
});

describe('strongSensitiveFlags and rulesFired', () => {
  it('report strong flagged categories and whether any rule fired', () => {
    const result = rules({
      sensitive: [
        sensitiveMatch('health', 'strong'),
        sensitiveMatch('legal', 'weak'),
        sensitiveMatch('adult', 'weak', false),
      ],
    });
    expect(strongSensitiveFlags(result)).toEqual(['health']);
    expect(rulesFired(result)).toBe(true);
    expect(rulesFired(rules({ commercial: [commercialMatch('travel.hotels')] }))).toBe(true);
    expect(rulesFired(rules())).toBe(false);
  });
});
