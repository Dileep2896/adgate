/**
 * Demand adapters (docs/BUILD_GUIDE.md Phase 3). Public surface of packages/core/src/demand:
 * the DemandAdapter contract, the DirectAdapter and AffiliateAdapter over an in-memory catalog,
 * and the selection, matching and response helpers the adapters and mediation share.
 */
export * from './affiliate/index.js';
export { CREATIVE_ID_PREFIX, assignCreativeIds, creativeId } from './catalog.js';
export {
  DIRECT_MAX_CANDIDATES,
  DirectAdapter,
  createDirectAdapter,
  selectDirectCandidates,
} from './direct.js';
export {
  isPatternSource,
  keywordMatches,
  keywordOverlap,
  keywordsFromRulesMatches,
  matchedKeywords,
  normalizeKeywords,
} from './keywords.js';
export {
  CATEGORY_WEIGHT,
  EXACT_CATEGORY_SCORE,
  KEYWORD_WEIGHT,
  WILDCARD_CATEGORY_SCORE,
  WILDCARD_SUFFIX,
  categoryScore,
  isWildcardTarget,
  matchesTargetCategory,
  targetingScore,
} from './match.js';
export type { TargetingScore } from './match.js';
export { creativeServesRegion } from './regions.js';
export { demandResponse, describeError, latencySince, safeNow } from './response.js';
export type { Clock } from './response.js';
export { MAX_CANDIDATES, compareCandidates, matchScore, rankCandidates } from './select.js';
export { DEFAULT_DEMAND_TIMEOUT_MS } from './types.js';
export type { DemandAdapter, DemandFetchOptions, DirectAdapterOptions } from './types.js';
