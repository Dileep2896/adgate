import { normalizeText } from '../rules/normalize.js';
import { fakeLlmSuccess } from './fake.js';
import { normalizeCategories, normalizeSensitive } from './output.js';
import type { LlmClassifyResult } from './types.js';

/**
 * Builds a FakeLlmClassifier script from fixtures/classify-fixtures.json cases so the full
 * two-stage classifier (S08) can be tested against the golden set with an "ideal" model: the
 * fake answers exactly what the fixture expects. The caller reads and parses the file (core
 * never touches the filesystem); the shapes below mirror the fixture, `note` and unknown keys
 * are ignored.
 */
export interface ClassifyFixtureExpect {
  sensitive: string[];
  categories_any?: string[];
  intent_min?: number;
  intent_max?: number;
}

export interface ClassifyFixtureCase {
  id: string;
  text: string;
  expect: ClassifyFixtureExpect;
  note?: string;
}

export const FIXTURE_LLM_CONFIDENCE = 0.9;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Midpoint of [intent_min, intent_max] when both bounds exist; otherwise 0.9 for a serve-able
 * case, 0.1 for a sensitive one and 0 for self_harm (the LLM stage wins on intent in the merge,
 * so sensitive fixtures must not look like a buying context).
 */
const fixtureIntent = (c: ClassifyFixtureCase): number => {
  const { intent_min, intent_max, sensitive } = c.expect;
  if (intent_min !== undefined && intent_max !== undefined) {
    return round3((intent_min + intent_max) / 2);
  }
  if (sensitive.includes('self_harm')) {
    return 0;
  }
  return sensitive.length > 0 ? 0.1 : 0.9;
};

export const fixtureLlmResult = (c: ClassifyFixtureCase): LlmClassifyResult =>
  fakeLlmSuccess({
    commercial_intent: fixtureIntent(c),
    categories: normalizeCategories(c.expect.categories_any ?? []),
    sensitive: normalizeSensitive(c.expect.sensitive),
    confidence: FIXTURE_LLM_CONFIDENCE,
  });

/** What the fake answers for text that matches no fixture: low intent, general, unsure. */
export const unknownTextLlmResult = (): LlmClassifyResult =>
  fakeLlmSuccess({
    commercial_intent: 0.1,
    categories: ['general'],
    sensitive: [],
    confidence: 0.5,
  });

/**
 * Matching is on normalizeText(text): an exact match first, then the longest fixture text
 * contained in the input, so a joined multi-turn conversation that includes a fixture message
 * still hits it. Anything else gets unknownTextLlmResult().
 */
export const fakeLlmFromFixtures = (
  cases: readonly ClassifyFixtureCase[],
): ((text: string) => LlmClassifyResult) => {
  const byText = new Map<string, ClassifyFixtureCase>();
  for (const c of cases) {
    const key = normalizeText(c.text);
    if (key !== '' && !byText.has(key)) {
      byText.set(key, c);
    }
  }
  const longestFirst = [...byText.entries()].sort((a, b) => b[0].length - a[0].length);

  return (text: string): LlmClassifyResult => {
    const normalized = normalizeText(text);
    const exact = byText.get(normalized);
    if (exact !== undefined) {
      return fixtureLlmResult(exact);
    }
    const contained = longestFirst.find(([key]) => normalized.includes(key));
    return contained === undefined ? unknownTextLlmResult() : fixtureLlmResult(contained[1]);
  };
};
