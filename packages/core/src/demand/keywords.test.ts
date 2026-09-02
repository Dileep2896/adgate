import { describe, expect, it } from 'vitest';

import { classifyByRules } from '../classify/rules/classify.js';
import {
  isPatternSource,
  keywordMatches,
  keywordOverlap,
  keywordsFromRulesMatches,
  matchedKeywords,
  normalizeKeywords,
} from './keywords.js';

describe('normalizeKeywords', () => {
  it('lowercases, strips punctuation, applies aliases, drops blanks and duplicates', () => {
    expect(normalizeKeywords(['Postgres', ' postgres ', 'Learn-Spanish!', '', '  '])).toEqual([
      'postgres',
      'learn spanish',
    ]);
    expect(normalizeKeywords(["don't"])).toEqual(['do not']);
  });
});

describe('keywordMatches', () => {
  it('matches equal phrases and whole-token containment in either direction', () => {
    expect(keywordMatches('postgres', 'postgres')).toBe(true);
    expect(keywordMatches('postgres', 'postgres hosting')).toBe(true);
    expect(keywordMatches('managed postgres', 'postgres')).toBe(true);
    expect(keywordMatches('neon', 'neon db')).toBe(true);
  });

  it('never matches inside a token', () => {
    expect(keywordMatches('ci', 'circleci')).toBe(false);
    expect(keywordMatches('render', 'renders')).toBe(false);
    expect(keywordMatches('fly', 'firefly io')).toBe(false);
  });
});

describe('matchedKeywords and keywordOverlap', () => {
  const creativeKeywords = ['postgres', 'database', 'hosting', 'supabase', 'neon'];

  it('returns the creative keywords hit by any request keyword, normalized', () => {
    expect(matchedKeywords(creativeKeywords, ['Postgres hosting', 'free tier'])).toEqual([
      'postgres',
      'hosting',
    ]);
    expect(keywordOverlap(creativeKeywords, ['Postgres hosting', 'free tier'])).toBe(0.4);
  });

  it('is 0 without creative keywords or request keywords and 1 on a full hit', () => {
    expect(keywordOverlap([], ['postgres'])).toBe(0);
    expect(keywordOverlap(creativeKeywords, [])).toBe(0);
    expect(keywordOverlap(['postgres', 'Postgres'], ['postgres'])).toBe(1);
  });
});

describe('isPatternSource', () => {
  it('separates dictionary phrases from regex sources', () => {
    expect(isPatternSource('postgres hosting')).toBe(false);
    expect(isPatternSource('learn spanish')).toBe(false);
    expect(isPatternSource(String.raw`\bmanaged (postgres|mysql)\b`)).toBe(true);
    expect(isPatternSource('a+')).toBe(true);
    expect(isPatternSource('a.b')).toBe(false);
  });
});

describe('keywordsFromRulesMatches', () => {
  it('collects the commercial phrase terms of the c001 fixture text, without pattern sources', () => {
    const result = classifyByRules(
      'which postgres hosting should I use for a side project with a free tier',
    );
    const keywords = keywordsFromRulesMatches(result.matches);
    expect(keywords).toEqual(['postgres hosting', 'postgres', 'hosting']);
    for (const keyword of keywords) {
      expect(isPatternSource(keyword)).toBe(false);
    }
  });

  it('ignores intent, informational and sensitive terms', () => {
    const result = classifyByRules('should i buy a gun');
    const keywords = keywordsFromRulesMatches(result.matches);
    expect(keywords).not.toContain('should i buy');
    expect(keywords).not.toContain('gun');
    expect(keywordsFromRulesMatches(classifyByRules('').matches)).toEqual([]);
  });
});
