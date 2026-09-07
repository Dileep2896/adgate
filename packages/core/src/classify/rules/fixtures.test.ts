import { readFileSync } from 'node:fs';

import { ClassifyFixture, type ClassifyFixtureCase } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { classifyByRules } from './classify.js';

/**
 * The golden set. Sensitive cases must be caught by rules alone (zero false negatives), serve
 * and low-intent cases must never be flagged sensitive (zero false positives, because the
 * two-stage classifier unions rule and LLM flags), and the software.devtools.* serve cases
 * must be servable by rules alone so the quickstart works without an LLM key.
 */
const { cases } = ClassifyFixture.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../../../fixtures/classify-fixtures.json', import.meta.url),
      'utf8',
    ),
  ),
);
const sensitiveCases = cases.filter((c) => c.id.startsWith('s'));
const serveCases = cases.filter((c) => c.id.startsWith('c'));
const lowCases = cases.filter((c) => c.id.startsWith('l'));

const isDevtools = (c: ClassifyFixtureCase) =>
  (c.expect.categories_any ?? []).some((category) => category.startsWith('software.devtools.'));
const quickstartCases = serveCases.filter((c) => c.id === 'c001' || isDevtools(c));
const remainingCases = [...serveCases.filter((c) => !quickstartCases.includes(c)), ...lowCases];

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
    expect(quickstartCases.map((c) => c.id)).toEqual([
      'c001',
      'c002',
      'c003',
      'c004',
      'c005',
      'c006',
      'c024',
    ]);
  });
});

describe('sensitive cases: zero false negatives by rules alone', () => {
  it.each(sensitiveCases)('$id is flagged with every expected category', (c) => {
    const result = classifyByRules(c.text);
    for (const category of c.expect.sensitive) {
      expect(result.sensitive, `${c.id}: ${JSON.stringify(result.matches)}`).toContain(category);
    }
    // A sensitive hit caps commercial intent so the engine suppresses on rules alone.
    expect(result.commercial_intent).toBeLessThanOrEqual(0.2);
    // Every fixture sensitive case is a strong (phrase or pattern) match, not a weak pair.
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('self_harm cases get commercial_intent 0', () => {
    const selfHarm = sensitiveCases.filter((c) => c.expect.sensitive.includes('self_harm'));
    expect(selfHarm).toHaveLength(3);
    for (const c of selfHarm) {
      expect(classifyByRules(c.text).commercial_intent).toBe(0);
    }
  });
});

describe('serve and low-intent cases: zero false positives', () => {
  it.each([...serveCases, ...lowCases])('$id gets no sensitive flag', (c) => {
    const result = classifyByRules(c.text);
    expect(result.sensitive, `${c.id}: ${JSON.stringify(result.matches.sensitive)}`).toEqual([]);
  });
});

describe('quickstart cases: software.devtools.* served by rules alone', () => {
  it.each(quickstartCases)(
    '$id reaches confidence >= 0.7, intent within bounds and a listed category',
    (c) => {
      const result = classifyByRules(c.text);
      const detail = `${c.id}: ${JSON.stringify(result)}`;
      expect(result.confidence, detail).toBeGreaterThanOrEqual(0.7);
      expect(withinBounds(c, result.commercial_intent), detail).toBe(true);
      expect(hasListedCategory(c, result.categories), detail).toBe(true);
    },
  );
});

describe('remaining serve and low-intent cases by rules alone', () => {
  // Reached 32 of 32 when written (see progress.txt S06); the floor leaves room for keyword
  // edits without failing on any single case. The printed line shows the current number.
  const FLOOR = 30;

  it(`at least ${FLOOR} of ${remainingCases.length} satisfy intent bounds and categories`, () => {
    const missed: string[] = [];
    for (const c of remainingCases) {
      const result = classifyByRules(c.text);
      const ok =
        withinBounds(c, result.commercial_intent) && hasListedCategory(c, result.categories);
      if (!ok) {
        missed.push(
          `${c.id} intent=${result.commercial_intent} categories=${result.categories.join(',')}`,
        );
      }
    }
    const satisfied = remainingCases.length - missed.length;
    console.log(
      `rules-only: ${satisfied}/${remainingCases.length} remaining fixture cases satisfied` +
        (missed.length > 0 ? `; missed: ${missed.join(' | ')}` : ''),
    );
    expect(satisfied).toBeGreaterThanOrEqual(FLOOR);
  });
});
