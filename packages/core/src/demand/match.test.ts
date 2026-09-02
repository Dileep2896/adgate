import type { Classification } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import {
  CATEGORY_WEIGHT,
  KEYWORD_WEIGHT,
  WILDCARD_CATEGORY_SCORE,
  categoryScore,
  isWildcardTarget,
  matchesTargetCategory,
  targetingScore,
} from './match.js';

describe('matchesTargetCategory', () => {
  it('matches an exact category only, without a wildcard', () => {
    expect(matchesTargetCategory('software.devtools.database', 'software.devtools.database')).toBe(
      true,
    );
    expect(matchesTargetCategory('software.devtools', 'software.devtools.database')).toBe(false);
    expect(matchesTargetCategory('software.devtools.database', 'software.devtools')).toBe(false);
  });

  it('a trailing wildcard matches any deeper segment and nothing else', () => {
    expect(matchesTargetCategory('software.devtools.*', 'software.devtools.database')).toBe(true);
    expect(matchesTargetCategory('software.devtools.*', 'software.devtools.ci.hosted')).toBe(true);
    expect(matchesTargetCategory('software.*', 'software.security')).toBe(true);
    expect(matchesTargetCategory('software.devtools.*', 'software.security')).toBe(false);
    expect(matchesTargetCategory('software.devtools.*', 'software.devtools')).toBe(false);
    expect(matchesTargetCategory('software.devtools.*', 'software.devtoolsx.ci')).toBe(false);
    expect(matchesTargetCategory('software.devtools.*', 'software.devtools.')).toBe(false);
    expect(matchesTargetCategory('software.*', 'general')).toBe(false);
  });

  it('isWildcardTarget requires a segment before the wildcard', () => {
    expect(isWildcardTarget('software.*')).toBe(true);
    expect(isWildcardTarget('.*')).toBe(false);
    expect(isWildcardTarget('*')).toBe(false);
    expect(isWildcardTarget('software.devtools')).toBe(false);
  });
});

describe('categoryScore', () => {
  it('scores exact hits 1, wildcard hits lower, misses 0', () => {
    expect(categoryScore(['software.devtools.database'], ['software.devtools.database'])).toBe(1);
    expect(categoryScore(['software.devtools.*'], ['software.devtools.database'])).toBe(
      WILDCARD_CATEGORY_SCORE,
    );
    expect(categoryScore(['software.security'], ['software.devtools.database'])).toBe(0);
    expect(categoryScore([], ['software.devtools.database'])).toBe(0);
    expect(categoryScore(['software.*'], [])).toBe(0);
  });

  it('takes the best hit across all targets and categories', () => {
    expect(
      categoryScore(
        ['software.devtools.*', 'software.devtools.hosting'],
        ['software.devtools.database', 'software.devtools.hosting'],
      ),
    ).toBe(1);
    expect(
      categoryScore(['software.devtools.*', 'education.language'], ['software.devtools.ci']),
    ).toBe(WILDCARD_CATEGORY_SCORE);
  });
});

describe('targetingScore', () => {
  const classification: Pick<Classification, 'categories'> = {
    categories: ['software.devtools.database'],
  };

  it('weights category over keywords and rounds to three decimals', () => {
    const exact = targetingScore(
      { target_categories: ['software.devtools.database'], keywords: ['postgres', 'neon'] },
      classification,
      ['postgres'],
    );
    expect(exact).toEqual({
      category: 1,
      keyword: 0.5,
      score: CATEGORY_WEIGHT + KEYWORD_WEIGHT / 2,
    });
    const wildcard = targetingScore(
      { target_categories: ['software.devtools.*'], keywords: ['a', 'b', 'c'] },
      classification,
      ['a'],
    );
    expect(wildcard.score).toBe(
      Math.round((CATEGORY_WEIGHT * WILDCARD_CATEGORY_SCORE + KEYWORD_WEIGHT / 3) * 1000) / 1000,
    );
    expect(wildcard.score).toBe(0.683);
  });

  it('is exactly 1 for an exact category hit with full keyword overlap', () => {
    const full = targetingScore(
      { target_categories: ['software.devtools.database'], keywords: ['postgres'] },
      classification,
      ['postgres hosting'],
    );
    expect(full.score).toBe(1);
  });

  it('is 0 without a category hit, however many keywords match', () => {
    const none = targetingScore(
      { target_categories: ['education.language'], keywords: ['postgres'] },
      classification,
      ['postgres'],
    );
    expect(none).toEqual({ category: 0, keyword: 1, score: 0 });
    expect(CATEGORY_WEIGHT + KEYWORD_WEIGHT).toBe(1);
  });
});
