import { readFileSync } from 'node:fs';

import { ClassifyFixture, fixtureMessages, type ClassifyFixtureCase } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { prepareText } from '../prepare.js';
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

/**
 * Exactly what the rules stage sees inside classify(): prepareText().rulesText over the case's
 * turns, which for a single-turn case is its `text` and for a multi-turn case is the last four
 * turns' content, one per line. A multi-turn sensitive case is caught by a term in an EARLIER
 * turn, so matching on `text` alone would silently stop testing what these cases exist for.
 */
const rulesTextOf = (c: ClassifyFixtureCase) =>
  prepareText({ messages: fixtureMessages(c) }).rulesText;

const isDevtools = (c: ClassifyFixtureCase) =>
  (c.expect.categories_any ?? []).some((category) => category.startsWith('software.devtools.'));

/**
 * The two devtools cases the keyword rules genuinely cannot serve. Their final user turn names
 * no product at all ("what do people use to get told about these automatically", "where should
 * I move the app instead?"); every product term is in the debugging turns above it, so the
 * rules find the category but read the turn as troubleshooting and score the intent too low.
 * That is precisely what the LLM stage is for. They are named here, and asserted below, rather
 * than quietly dropped from the quickstart set: if a keyword edit ever makes them servable, the
 * assertion fails and this list is what you delete.
 */
const RULES_CANNOT_SERVE = ['c027', 'c029'];
const quickstartCases = serveCases.filter(
  (c) => (c.id === 'c001' || isDevtools(c)) && !RULES_CANNOT_SERVE.includes(c.id),
);
const remainingCases = [...serveCases.filter((c) => !quickstartCases.includes(c)), ...lowCases];

const withinBounds = (c: ClassifyFixtureCase, intent: number) =>
  intent >= (c.expect.intent_min ?? 0) && intent <= (c.expect.intent_max ?? 1);
const hasListedCategory = (c: ClassifyFixtureCase, categories: string[]) =>
  c.expect.categories_any === undefined ||
  c.expect.categories_any.some((category) => categories.includes(category));

describe('fixture shape', () => {
  it('has 85 cases: 34 sensitive, 33 serve, 18 low intent', () => {
    expect(cases).toHaveLength(85);
    expect(sensitiveCases).toHaveLength(34);
    expect(serveCases).toHaveLength(33);
    expect(lowCases).toHaveLength(18);
    // The multi-turn devtools cases whose final turn still names the product (c026, c028, c030,
    // c033) are quickstart cases too: the rules read the whole prepared window, so those terms
    // still fire. c027 and c029 are the two that name none; see RULES_CANNOT_SERVE.
    expect(quickstartCases.map((c) => c.id)).toEqual([
      'c001',
      'c002',
      'c003',
      'c004',
      'c005',
      'c006',
      'c024',
      'c026',
      'c028',
      'c030',
      'c033',
    ]);
  });
});

describe('sensitive cases: zero false negatives by rules alone', () => {
  it.each(sensitiveCases)('$id is flagged with every expected category', (c) => {
    const result = classifyByRules(rulesTextOf(c));
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
    expect(selfHarm).toHaveLength(4);
    for (const c of selfHarm) {
      expect(classifyByRules(rulesTextOf(c)).commercial_intent).toBe(0);
    }
  });
});

describe('serve and low-intent cases: zero false positives', () => {
  it.each([...serveCases, ...lowCases])('$id gets no sensitive flag', (c) => {
    const result = classifyByRules(rulesTextOf(c));
    expect(result.sensitive, `${c.id}: ${JSON.stringify(result.matches.sensitive)}`).toEqual([]);
  });
});

describe('quickstart cases: software.devtools.* served by rules alone', () => {
  it.each(quickstartCases)(
    '$id reaches confidence >= 0.7, intent within bounds and a listed category',
    (c) => {
      const result = classifyByRules(rulesTextOf(c));
      const detail = `${c.id}: ${JSON.stringify(result)}`;
      expect(result.confidence, detail).toBeGreaterThanOrEqual(0.7);
      expect(withinBounds(c, result.commercial_intent), detail).toBe(true);
      expect(hasListedCategory(c, result.categories), detail).toBe(true);
    },
  );
});

describe('the devtools cases rules alone cannot serve', () => {
  const unserved = serveCases.filter((c) => RULES_CANNOT_SERVE.includes(c.id));

  it('is exactly c027 and c029, and both are multi-turn', () => {
    expect(unserved.map((c) => c.id)).toEqual(RULES_CANNOT_SERVE);
    for (const c of unserved) {
      expect(c.messages, c.id).toBeDefined();
    }
  });

  it.each(unserved)('$id keeps its category but falls short of its intent band', (c) => {
    const result = classifyByRules(rulesTextOf(c));
    const detail = `${c.id}: ${JSON.stringify(result)}`;
    // The category survives: the debugging turns carry the product terms.
    expect(hasListedCategory(c, result.categories), detail).toBe(true);
    // The intent does not: nothing in the window reads as a purchase to a keyword matcher.
    expect(withinBounds(c, result.commercial_intent), detail).toBe(false);
    expect(result.sensitive, detail).toEqual([]);
  });
});

describe('remaining serve and low-intent cases by rules alone', () => {
  // Reached 32 of 32 when written (see progress.txt S06); the floor leaves room for keyword
  // edits without failing on any single case. The printed line shows the current number.
  const FLOOR = 30;

  it(`at least ${FLOOR} of ${remainingCases.length} satisfy intent bounds and categories`, () => {
    const missed: string[] = [];
    for (const c of remainingCases) {
      const result = classifyByRules(rulesTextOf(c));
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
