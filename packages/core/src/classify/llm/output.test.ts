import { Classification } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { normalizeCategories, normalizeSensitive, parseLlmContent } from './output.js';
import { PROMPT_VERSION } from './prompt.js';

const valid = {
  commercial_intent: 0.84,
  categories: ['software.devtools.database'],
  sensitive: [],
  confidence: 0.91,
};

describe('parseLlmContent', () => {
  it('maps a valid JSON object into a Classification with method llm and PROMPT_VERSION', () => {
    const result = parseLlmContent(JSON.stringify(valid));
    expect(result).toEqual({
      ok: true,
      classification: { ...valid, method: 'llm', prompt_version: PROMPT_VERSION },
    });
    if (result.ok) {
      expect(Classification.safeParse(result.classification).success).toBe(true);
    }
  });

  it('normalizes categories and sensitive flags to the taxonomy', () => {
    const result = parseLlmContent(
      JSON.stringify({
        ...valid,
        categories: ['Software.Devtools.Database', ' SOFTWARE.SECURITY ', 'not.a.category'],
        sensitive: ['Health', 'Self-Harm', 'self harm', 'weather'],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      classification: {
        categories: ['software.devtools.database', 'software.security'],
        sensitive: ['health', 'self_harm'],
      },
    });
  });

  it('turns an empty or fully unknown categories list into [general]', () => {
    for (const categories of [[], ['made.up'], ['General']]) {
      const result = parseLlmContent(JSON.stringify({ ...valid, categories }));
      expect(result).toMatchObject({ ok: true, classification: { categories: ['general'] } });
    }
  });

  it('clamps the two numbers into [0, 1] instead of rejecting them', () => {
    const high = parseLlmContent(JSON.stringify({ ...valid, commercial_intent: 1.4 }));
    expect(high).toMatchObject({ ok: true, classification: { commercial_intent: 1 } });
    const low = parseLlmContent(JSON.stringify({ ...valid, confidence: -0.2 }));
    expect(low).toMatchObject({ ok: true, classification: { confidence: 0 } });
  });

  it('accepts JSON wrapped in a markdown code fence', () => {
    const fenced = '```json\n' + JSON.stringify(valid) + '\n```';
    expect(parseLlmContent(fenced)).toMatchObject({ ok: true });
    expect(parseLlmContent('```\n' + JSON.stringify(valid) + '```')).toMatchObject({ ok: true });
  });

  it('returns reason parse for malformed JSON without echoing the content', () => {
    for (const content of ['not json', '', '{"commercial_intent": 0.5,', 'null trailing']) {
      const result = parseLlmContent(content);
      expect(result).toMatchObject({ ok: false, reason: 'parse' });
      if (!result.ok) {
        expect(result.detail).not.toContain('commercial_intent');
        expect(result.detail).not.toContain('not json');
      }
    }
  });

  it('returns reason invalid for JSON that is not the expected shape', () => {
    const cases: unknown[] = [
      { ...valid, confidence: 'high' },
      { ...valid, commercial_intent: '0.5' },
      { ...valid, categories: 'software.security' },
      { ...valid, sensitive: [1] },
      { commercial_intent: 0.5, categories: [], sensitive: [] },
      [],
      null,
      42,
      'text',
    ];
    for (const value of cases) {
      const result = parseLlmContent(JSON.stringify(value));
      expect(result, JSON.stringify(value)).toMatchObject({ ok: false, reason: 'invalid' });
    }
  });

  it('reports invalid details as paths and codes, never values', () => {
    const result = parseLlmContent(JSON.stringify({ ...valid, confidence: 'top secret' }));
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    if (!result.ok) {
      expect(result.detail).toContain('confidence');
      expect(result.detail).not.toContain('top secret');
    }
  });

  it('never throws on any string input', () => {
    for (const content of [' ', '{"a":', '[[[', '"\\u"', '{"__proto__": {}}']) {
      expect(() => parseLlmContent(content)).not.toThrow();
    }
  });
});

describe('normalizeCategories and normalizeSensitive', () => {
  it('lowercase, trim, drop unknown, dedupe, keep order', () => {
    expect(normalizeCategories(['Travel.Flights', 'travel.flights', 'x', 'general'])).toEqual([
      'travel.flights',
      'general',
    ]);
    expect(normalizeCategories([])).toEqual(['general']);
    expect(normalizeSensitive(['FINANCE', 'finance', 'Self Harm', 'x'])).toEqual([
      'finance',
      'self_harm',
    ]);
    expect(normalizeSensitive([])).toEqual([]);
  });
});
