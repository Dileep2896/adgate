import type { CatalogCreative, Classification } from '@adgate/schemas';

import { keywordOverlap } from './keywords.js';

/**
 * Targeting score of one creative for one classification: category match (dominant) plus
 * keyword overlap. A creative must match on category to be a candidate at all; keywords only
 * raise the score. targeting_match is in [0, 1] and rounded to three decimals.
 */
export const WILDCARD_SUFFIX = '.*';
export const EXACT_CATEGORY_SCORE = 1;
/** A wildcard hit (software.devtools.* for software.devtools.database) is less specific. */
export const WILDCARD_CATEGORY_SCORE = 0.8;
export const CATEGORY_WEIGHT = 0.75;
export const KEYWORD_WEIGHT = 0.25;

export const isWildcardTarget = (target: string): boolean =>
  target.length > WILDCARD_SUFFIX.length && target.endsWith(WILDCARD_SUFFIX);

/**
 * software.devtools.* matches software.devtools.database and software.devtools.ci.hosted but
 * not software.devtools itself, software.security or softwarex.devtools.x. Without a wildcard
 * the target must equal the category.
 */
export const matchesTargetCategory = (target: string, category: string): boolean => {
  if (isWildcardTarget(target)) {
    const prefix = target.slice(0, -1);
    return category.length > prefix.length && category.startsWith(prefix);
  }
  return target === category;
};

/** 1 for an exact hit, 0.8 for a wildcard-only hit, 0 when nothing matches. */
export const categoryScore = (
  targets: readonly string[],
  categories: readonly string[],
): number => {
  let best = 0;
  for (const target of targets) {
    const score = isWildcardTarget(target) ? WILDCARD_CATEGORY_SCORE : EXACT_CATEGORY_SCORE;
    if (score > best && categories.some((category) => matchesTargetCategory(target, category))) {
      best = score;
    }
  }
  return best;
};

export interface TargetingScore {
  /** categoryScore of the creative's targets against the classification. */
  category: number;
  /** keywordOverlap of the creative's keywords against the request keywords. */
  keyword: number;
  /** The combined targeting_match; 0 when the category did not match. */
  score: number;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export const targetingScore = (
  creative: Pick<CatalogCreative, 'target_categories' | 'keywords'>,
  classification: Pick<Classification, 'categories'>,
  requestKeywords: readonly string[],
): TargetingScore => {
  const category = categoryScore(creative.target_categories, classification.categories);
  const keyword = keywordOverlap(creative.keywords, requestKeywords);
  const score = category === 0 ? 0 : round3(CATEGORY_WEIGHT * category + KEYWORD_WEIGHT * keyword);
  return { category, keyword, score };
};
