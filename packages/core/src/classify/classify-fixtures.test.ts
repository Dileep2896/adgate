import { readFileSync } from 'node:fs';

import { Classification, ClassifyFixture, type ClassifyFixtureCase } from '@adgate/schemas';
import { beforeAll, describe, expect, it } from 'vitest';

import { createLruCache } from './cache.js';
import { classify } from './classify.js';
import { FakeLlmClassifier } from './llm/fake.js';
import { fakeLlmFromFixtures } from './llm/fixtures.js';
import type { ClassifyOutcome, ClassifyPolicy } from './types.js';

/**
 * The full two-stage classifier over the golden set with the fixture-seeded fake LLM
 * (docs/BUILD_GUIDE.md Phase 2): sensitive recall and precision must both be 100 percent, serve
 * cases must land inside their intent bounds with a listed category, and low-intent cases must
 * stay under intent_max. A second pass must be served entirely from the cache.
 */
const { cases } = ClassifyFixture.parse(
  JSON.parse(
    readFileSync(new URL('../../../../fixtures/classify-fixtures.json', import.meta.url), 'utf8'),
  ),
);
const sensitiveCases = cases.filter((c) => c.id.startsWith('s'));
const serveCases = cases.filter((c) => c.id.startsWith('c'));
const lowCases = cases.filter((c) => c.id.startsWith('l'));
const nonSensitiveCases = [...serveCases, ...lowCases];

const STRICT: ClassifyPolicy = { sensitive_detection: 'strict', min_confidence: 0.7 };
const BALANCED: ClassifyPolicy = { sensitive_detection: 'balanced', min_confidence: 0.7 };

const input = (c: ClassifyFixtureCase) => ({
  messages: [{ role: 'user' as const, content: c.text }],
});

const runAll = async (
  policy: ClassifyPolicy,
  llm: FakeLlmClassifier | null,
  cache: ReturnType<typeof createLruCache> | undefined,
): Promise<Map<string, ClassifyOutcome>> => {
  const outcomes = new Map<string, ClassifyOutcome>();
  for (const c of cases) {
    outcomes.set(c.id, await classify(input(c), { llm, cache, policy }));
  }
  return outcomes;
};

const outcomeOf = (outcomes: Map<string, ClassifyOutcome>, id: string): ClassifyOutcome => {
  const outcome = outcomes.get(id);
  if (outcome === undefined) {
    throw new Error(`no outcome for ${id}`);
  }
  return outcome;
};

const withinBounds = (c: ClassifyFixtureCase, intent: number) =>
  intent >= (c.expect.intent_min ?? 0) && intent <= (c.expect.intent_max ?? 1);
const hasListedCategory = (c: ClassifyFixtureCase, categories: string[]) =>
  c.expect.categories_any === undefined ||
  c.expect.categories_any.some((category) => categories.includes(category));

describe('fixture shape', () => {
  it('has 67 cases: 28 sensitive, 25 serve, 14 low intent', () => {
    expect(cases).toHaveLength(67);
    expect(sensitiveCases).toHaveLength(28);
    expect(serveCases).toHaveLength(25);
    expect(lowCases).toHaveLength(14);
  });
});

describe.each([
  ['strict', STRICT],
  ['balanced', BALANCED],
])('full fixture run with the fixture-seeded fake LLM under %s detection', (_name, policy) => {
  const llm = new FakeLlmClassifier(fakeLlmFromFixtures(cases));
  const cache = createLruCache();
  let first = new Map<string, ClassifyOutcome>();
  let second = new Map<string, ClassifyOutcome>();
  let callsAfterFirst = -1;

  beforeAll(async () => {
    first = await runAll(policy, llm, cache);
    callsAfterFirst = llm.callCount;
    second = await runAll(policy, llm, cache);
  });

  it('flags every sensitive case with every expected category (100 percent recall)', () => {
    for (const c of sensitiveCases) {
      const { classification } = outcomeOf(first, c.id);
      for (const category of c.expect.sensitive) {
        expect(classification.sensitive, `${c.id}: ${JSON.stringify(classification)}`).toContain(
          category,
        );
      }
      expect(classification.commercial_intent, c.id).toBeLessThanOrEqual(0.2);
      expect(classification.confidence, c.id).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('flags no serve or low-intent case as sensitive (100 percent precision)', () => {
    for (const c of nonSensitiveCases) {
      expect(outcomeOf(first, c.id).classification.sensitive, c.id).toEqual([]);
    }
  });

  it('keeps every serve case inside its intent bounds with a listed category', () => {
    for (const c of serveCases) {
      const { classification } = outcomeOf(first, c.id);
      const detail = `${c.id}: ${JSON.stringify(classification)}`;
      expect(withinBounds(c, classification.commercial_intent), detail).toBe(true);
      expect(hasListedCategory(c, classification.categories), detail).toBe(true);
    }
  });

  it('keeps every low-intent case under intent_max', () => {
    for (const c of lowCases) {
      const { classification } = outcomeOf(first, c.id);
      expect(classification.commercial_intent, c.id).toBeLessThanOrEqual(c.expect.intent_max ?? 1);
    }
  });

  it('short-circuits sensitive cases on rules and merges the rest with the LLM', () => {
    for (const c of sensitiveCases) {
      const outcome = outcomeOf(first, c.id);
      expect(outcome.source, c.id).toBe('rules_short_circuit');
      expect(outcome.classification.method, c.id).toBe('rules');
    }
    for (const c of nonSensitiveCases) {
      const outcome = outcomeOf(first, c.id);
      expect(outcome.source, c.id).toBe('merged');
      expect(outcome.classification.method, c.id).toBe('llm');
    }
    expect(callsAfterFirst).toBe(nonSensitiveCases.length);
  });

  it('keeps every serve case at or above the default min_confidence after the merge', () => {
    // Rules fire on every serve case (a product or topic match) so confidence is
    // min(rules, llm); the fixture rules confidence is high enough that the default policy
    // (min_confidence 0.7) still serves. Low-intent cases may drop lower; they suppress anyway.
    for (const c of serveCases) {
      expect(outcomeOf(first, c.id).classification.confidence, c.id).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('serves the whole second pass from the cache with method cached and no LLM calls', () => {
    for (const c of cases) {
      const outcome = outcomeOf(second, c.id);
      expect(outcome.source, c.id).toBe('cache');
      expect(outcome.classification, c.id).toEqual({
        ...outcomeOf(first, c.id).classification,
        method: 'cached',
      });
    }
    expect(llm.callCount).toBe(callsAfterFirst);
    expect(cache.size).toBe(cases.length);
  });

  it('returns valid Classification objects without rule match detail', () => {
    for (const outcome of [...first.values(), ...second.values()]) {
      expect(Classification.parse(outcome.classification)).toEqual(outcome.classification);
      expect(outcome.classification).not.toHaveProperty('matches');
      expect(outcome.cache_key).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});

describe('full fixture run with no LLM configured (rules only)', () => {
  let outcomes = new Map<string, ClassifyOutcome>();

  beforeAll(async () => {
    outcomes = await runAll(STRICT, null, createLruCache());
  });

  it('still catches every sensitive case and flags no other case', () => {
    for (const c of sensitiveCases) {
      const outcome = outcomeOf(outcomes, c.id);
      expect(outcome.source, c.id).toBe('rules_short_circuit');
      for (const category of c.expect.sensitive) {
        expect(outcome.classification.sensitive, c.id).toContain(category);
      }
    }
    for (const c of nonSensitiveCases) {
      const outcome = outcomeOf(outcomes, c.id);
      expect(outcome.source, c.id).toBe('rules_fallback');
      expect(outcome.llm_failure, c.id).toBe('unavailable');
      expect(outcome.classification.method, c.id).toBe('rules');
      expect(outcome.classification.sensitive, c.id).toEqual([]);
    }
  });
});
