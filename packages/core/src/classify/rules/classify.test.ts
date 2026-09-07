import { Classification } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { classifyByRules } from './classify.js';
import { SCORING } from './data/scoring.js';
import { RULES_VERSION } from './version.js';

describe('classifyByRules', () => {
  it('returns a valid Classification with method rules and the rules version', () => {
    const result = classifyByRules('best vpn for public wifi');
    expect(Classification.safeParse(result).success).toBe(true);
    expect(result.method).toBe('rules');
    expect(result.prompt_version).toBe(RULES_VERSION);
    expect(result.categories[0]).toBe('software.security');
    expect(result.commercial_intent).toBeGreaterThanOrEqual(0.6);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('empty or content-free text: zero intent, general category, low confidence', () => {
    for (const text of ['', '   ', '!!! ...', '🎧🎧']) {
      const result = classifyByRules(text);
      expect(result).toMatchObject({
        commercial_intent: 0,
        categories: ['general'],
        sensitive: [],
      });
      expect(result.confidence).toBe(SCORING.confidence.base);
      expect(result.matches).toEqual({
        sensitive: [],
        commercial: [],
        intent: [],
        informational: [],
      });
    }
  });

  it('self_harm always flags and forces commercial_intent 0', () => {
    const result = classifyByRules('which is the best knife to hurt myself with');
    expect(result.sensitive).toContain('self_harm');
    expect(result.commercial_intent).toBe(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('a sensitive hit caps commercial_intent at 0.2 even with strong buying signals', () => {
    const result = classifyByRules('best credit card for travel points, cheapest annual fee');
    expect(result.sensitive).toEqual(['finance']);
    expect(result.commercial_intent).toBeLessThanOrEqual(SCORING.sensitive.max_intent);
    expect(result.commercial_intent).toBeGreaterThan(0);
  });

  it('a single weak sensitive keyword is reported but not flagged', () => {
    const result = classifyByRules('the doctor who reboot is great');
    expect(result.sensitive).toEqual([]);
    expect(result.matches.sensitive).toEqual([
      { category: 'health', strength: 'weak', terms: ['doctor'], flagged: false },
    ]);
  });

  it('two distinct weak keywords flag the category at lower confidence', () => {
    const result = classifyByRules('the doctor said the pain is normal');
    expect(result.sensitive).toEqual(['health']);
    expect(result.confidence).toBe(SCORING.sensitive.weak);
    expect(result.matches.sensitive[0]).toMatchObject({ strength: 'weak', flagged: true });
  });

  it('strong hits give confidence 0.9, corroborated hits 0.95', () => {
    expect(classifyByRules('ibuprofen').confidence).toBe(SCORING.sensitive.strong);
    expect(classifyByRules('ibuprofen dose for chest pain').confidence).toBe(
      SCORING.sensitive.corroborated,
    );
  });

  it('lists sensitive categories in taxonomy order', () => {
    expect(classifyByRules('which health insurance plan').sensitive).toEqual(['health', 'finance']);
  });

  it('orders categories by evidence with product hits before topic hits', () => {
    const result = classifyByRules('best vpn for public wifi');
    expect(result.categories).toEqual(['software.security', 'travel.connectivity']);
    expect(result.matches.commercial[0]).toMatchObject({ strength: 'product' });
    expect(result.matches.commercial[1]).toMatchObject({ strength: 'topic' });
  });

  it('reports matched dictionary terms, never the message text', () => {
    const text = 'recommend an error monitoring tool like Sentry but cheaper';
    const result = classifyByRules(text);
    expect(result.matches.intent).toContain('recommend');
    expect(result.matches.intent).toContain('cheaper');
    expect(result.matches.commercial[0]?.category).toBe('software.devtools.observability');
    expect(result.matches.commercial[0]?.terms).toContain('sentry');
    expect(JSON.stringify(result)).not.toContain(text);
  });

  it('applies aliases before matching', () => {
    expect(classifyByRules('is btc a good buy right now').sensitive).toEqual(['finance']);
    expect(classifyByRules('ibuprofin for my kid').sensitive).toEqual(['health']);
    expect(classifyByRules('accessories for my AR15').sensitive).toEqual(['weapons']);
    expect(classifyByRules('PostgreSQL hosting with a free tier').categories).toContain(
      'software.devtools.database',
    );
  });

  it('informational phrasing lowers intent', () => {
    const asking = classifyByRules('notion alternative that works offline').commercial_intent;
    const howTo = classifyByRules('how do i export a page from notion').commercial_intent;
    expect(howTo).toBeLessThan(asking);
    const explain = classifyByRules('explain python list comprehensions');
    expect(explain.commercial_intent).toBe(0);
    expect(explain.matches.informational).toEqual(['explain']);
  });

  it('never throws and always returns a schema-valid result on odd input', () => {
    const inputs = [
      'a'.repeat(50_000),
      '🎧'.repeat(1000),
      '1234567890',
      ['line one', 'line two', 'line three'].join('\n'),
      ' ',
      'ＢＥＳＴ ＶＰＮ',
    ];
    for (const text of inputs) {
      const result = classifyByRules(text);
      expect(Classification.safeParse(result).success, text.slice(0, 20)).toBe(true);
    }
  });

  it('is deterministic', () => {
    const text = 'cheapest vector database for a RAG side project';
    expect(classifyByRules(text)).toEqual(classifyByRules(text));
  });

  it('rounds scores to three decimals inside [0, 1]', () => {
    const result = classifyByRules('best cheapest recommended budget deal discount coupon buy');
    expect(result.commercial_intent).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeLessThanOrEqual(SCORING.confidence.max);
    expect(String(result.commercial_intent)).toMatch(/^\d(\.\d{1,3})?$/);
    expect(String(result.confidence)).toMatch(/^\d(\.\d{1,3})?$/);
  });
});
