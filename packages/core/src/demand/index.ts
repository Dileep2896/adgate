/**
 * Demand adapters (docs/BUILD_GUIDE.md Phase 3). Public surface of packages/core/src/demand:
 * the DemandAdapter contract, the DirectAdapter over an in-memory catalog, and the matching
 * helpers the other adapters and mediation reuse.
 */
export { CREATIVE_ID_PREFIX, assignCreativeIds, creativeId } from './catalog.js';
export {
  DIRECT_MAX_CANDIDATES,
  DirectAdapter,
  compareCandidates,
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
export { DEFAULT_DEMAND_TIMEOUT_MS } from './types.js';
export type { DemandAdapter, DemandFetchOptions, DirectAdapterOptions } from './types.js';
