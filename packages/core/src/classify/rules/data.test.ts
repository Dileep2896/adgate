import { CATEGORIES_TAXONOMY, SENSITIVE_TAXONOMY } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { RULES_DATA } from './data/index.js';
import { containsPhrase } from './match.js';
import { normalizeText } from './normalize.js';

/**
 * Hygiene for the keyword data. Every phrase must already be in normalized form (lowercase,
 * no punctuation, contractions expanded, aliases applied) so what is written in a data file
 * is exactly what gets matched, and lists must not contradict each other.
 */
const expectNormalized = (list: readonly string[], where: string) => {
  for (const phrase of list) {
    expect(normalizeText(phrase), `${where}: "${phrase}" is not normalized`).toBe(phrase);
    expect(phrase, `${where}: empty phrase`).not.toBe('');
  }
};

const expectUnique = (list: readonly string[], where: string) => {
  expect(new Set(list).size, `${where}: duplicate phrases`).toBe(list.length);
};

const expectDisjoint = (a: readonly string[], b: readonly string[], where: string) => {
  const overlap = a.filter((phrase) => b.includes(phrase));
  expect(overlap, `${where}: phrases in both lists`).toEqual([]);
};

const expectPatternsCompile = (patterns: readonly string[], where: string) => {
  for (const source of patterns) {
    expect(() => new RegExp(source), `${where}: bad pattern ${source}`).not.toThrow();
    expect(source, `${where}: pattern must be lowercase`).toBe(source.toLowerCase());
  }
};

describe('sensitive keyword data', () => {
  it('covers exactly the sensitive taxonomy, one rule set per category', () => {
    expect(Object.keys(RULES_DATA.sensitive).sort()).toEqual([...SENSITIVE_TAXONOMY].sort());
    for (const category of SENSITIVE_TAXONOMY) {
      expect(RULES_DATA.sensitive[category].category).toBe(category);
    }
  });

  it.each(SENSITIVE_TAXONOMY)('%s lists are normalized, unique and consistent', (category) => {
    const rules = RULES_DATA.sensitive[category];
    expectNormalized(rules.strong, `${category}.strong`);
    expectNormalized(rules.weak, `${category}.weak`);
    expectUnique(rules.strong, `${category}.strong`);
    expectUnique(rules.weak, `${category}.weak`);
    expectDisjoint(rules.strong, rules.weak, category);
    expectPatternsCompile(rules.patterns, category);
    expect(rules.strong.length, `${category} needs strong phrases`).toBeGreaterThan(0);
  });

  it.each(SENSITIVE_TAXONOMY)('%s exclusions are normalized and each masks a term', (category) => {
    const rules = RULES_DATA.sensitive[category];
    const exclusions = rules.exclusions ?? [];
    expectNormalized(exclusions, `${category}.exclusions`);
    expectUnique(exclusions, `${category}.exclusions`);
    const terms = [...rules.strong, ...rules.weak];
    for (const phrase of exclusions) {
      expect(
        terms.some((term) => containsPhrase(phrase, term)),
        `${category}.exclusions: "${phrase}" contains no strong or weak term`,
      ).toBe(true);
      expect(terms, `${category}.exclusions: "${phrase}" is itself a term`).not.toContain(phrase);
    }
  });
});

describe('commercial keyword data', () => {
  const commercial = CATEGORIES_TAXONOMY.filter((category) => category !== 'general');

  it('covers exactly the content taxonomy minus general', () => {
    expect(Object.keys(RULES_DATA.commercial).sort()).toEqual([...commercial].sort());
    for (const category of commercial) {
      expect(RULES_DATA.commercial[category].category).toBe(category);
    }
  });

  it.each(commercial)('%s lists are normalized, unique and consistent', (category) => {
    const rules = RULES_DATA.commercial[category];
    expectNormalized(rules.products, `${category}.products`);
    expectNormalized(rules.topics, `${category}.topics`);
    expectUnique(rules.products, `${category}.products`);
    expectUnique(rules.topics, `${category}.topics`);
    expectDisjoint(rules.products, rules.topics, category);
    expectPatternsCompile(rules.patterns, category);
    expect(rules.products.length, `${category} needs product phrases`).toBeGreaterThan(0);
  });

  it('never lists a sensitive strong phrase as a commercial term', () => {
    const sensitiveStrong = Object.values(RULES_DATA.sensitive).flatMap((rules) => rules.strong);
    for (const rules of Object.values(RULES_DATA.commercial)) {
      expectDisjoint([...rules.products, ...rules.topics], sensitiveStrong, rules.category);
    }
  });
});

describe('intent and informational data', () => {
  it('intent phrases are normalized, unique and weighted', () => {
    const phrases = RULES_DATA.intent.phrases.map((entry) => entry.phrase);
    expectNormalized(phrases, 'intent');
    expectUnique(phrases, 'intent');
    for (const { weight } of RULES_DATA.intent.phrases) {
      expect(RULES_DATA.scoring.intent.weights[weight]).toBeGreaterThan(0);
    }
    expectPatternsCompile(
      RULES_DATA.intent.patterns.map((entry) => entry.source),
      'intent.patterns',
    );
  });

  it('informational phrases are normalized, unique and disjoint from intent phrases', () => {
    expectNormalized(RULES_DATA.informational, 'informational');
    expectUnique(RULES_DATA.informational, 'informational');
    expectDisjoint(
      RULES_DATA.informational,
      RULES_DATA.intent.phrases.map((entry) => entry.phrase),
      'informational vs intent',
    );
  });

  it('scoring constants are unit-interval numbers with strong > medium > weak', () => {
    const { weights } = RULES_DATA.scoring.intent;
    expect(weights.strong).toBeGreaterThan(weights.medium);
    expect(weights.medium).toBeGreaterThan(weights.weak);
    const values = [
      ...Object.values(weights),
      RULES_DATA.scoring.intent.product_hit,
      RULES_DATA.scoring.intent.topic_hit,
      RULES_DATA.scoring.intent.informational_penalty,
      RULES_DATA.scoring.confidence.base,
      RULES_DATA.scoring.confidence.per_evidence,
      RULES_DATA.scoring.confidence.product_bonus,
      RULES_DATA.scoring.confidence.max,
      RULES_DATA.scoring.sensitive.strong,
      RULES_DATA.scoring.sensitive.corroborated,
      RULES_DATA.scoring.sensitive.weak,
      RULES_DATA.scoring.sensitive.max_intent,
    ];
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(RULES_DATA.scoring.sensitive.strong).toBeGreaterThanOrEqual(0.9);
    expect(RULES_DATA.scoring.sensitive.max_intent).toBeLessThanOrEqual(0.2);
    expect(RULES_DATA.scoring.sensitive.weak_hits_to_flag).toBeGreaterThanOrEqual(2);
  });
});
