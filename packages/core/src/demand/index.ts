/**
 * Demand adapters and mediation (docs/BUILD_GUIDE.md Phase 3). Public surface of
 * packages/core/src/demand: the DemandAdapter contract, the DirectAdapter and AffiliateAdapter
 * over an in-memory catalog, mediate() across adapters with the audit demand trace, and the
 * selection, matching, exclusion and response helpers the adapters and mediation share.
 */
export * from './affiliate/index.js';
export { CREATIVE_ID_PREFIX, assignCreativeIds, creativeId } from './catalog.js';
export {
  DIRECT_MAX_CANDIDATES,
  DirectAdapter,
  createDirectAdapter,
  selectDirectCandidates,
} from './direct.js';
export { domainMatches, isExcludedDomain, normalizeDomain } from './exclusions.js';
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
export {
  ADAPTER_ERROR_PREFIX,
  MEDIATION_ABORTED_ERROR,
  MEDIATION_TIMEOUT_ERROR,
  compareByRevenue,
  mediate,
  mediationScore,
} from './mediate.js';
export type { MediateOptions, MediationResult } from './mediate.js';
export { creativeServesRegion } from './regions.js';
export { demandResponse, describeError, latencySince, safeNow } from './response.js';
export type { Clock } from './response.js';
export { MAX_CANDIDATES, compareCandidates, matchScore, rankCandidates } from './select.js';
export { DEFAULT_DEMAND_TIMEOUT_MS } from './types.js';
export type { DemandAdapter, DemandFetchOptions, DirectAdapterOptions } from './types.js';
