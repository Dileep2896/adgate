/**
 * Demand adapters and mediation (docs/BUILD_GUIDE.md Phase 3). Public surface of
 * packages/core/src/demand: the DemandAdapter contract, the DirectAdapter and AffiliateAdapter
 * over an in-memory catalog, the Koah and Gravity stubs (docs/decisions.md item 10), mediate()
 * across adapters with the audit demand trace, the selection, matching, exclusion and
 * response helpers the adapters and mediation share, and creativeDeliverability(), the
 * diagnostic that says why a catalog creative can never serve for one app.
 */
export * from './affiliate/index.js';
export { CREATIVE_ID_PREFIX, assignCreativeIds, creativeId } from './catalog.js';
export {
  creativeDeliverability,
  enabledAffiliateNetworks,
  enabledDemandSources,
  targetCategoryBase,
} from './deliverability.js';
export type { DeliverabilityContext, DeliverabilityCreative } from './deliverability.js';
export {
  DIRECT_MAX_CANDIDATES,
  DirectAdapter,
  createDirectAdapter,
  selectDirectCandidates,
} from './direct.js';
export { domainMatches, isExcludedDomain, normalizeDomain } from './exclusions.js';
export { GravityAdapter, createGravityAdapter } from './gravity.js';
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
export { KoahAdapter, createKoahAdapter } from './koah.js';
export {
  ADAPTER_ERROR_PREFIX,
  MEDIATION_ABORTED_ERROR,
  MEDIATION_TIMEOUT_ERROR,
  mediate,
} from './mediate.js';
export type { MediateOptions, MediationResult } from './mediate.js';
export {
  NETWORK_NOT_CONFIGURED,
  NETWORK_NOT_IMPLEMENTED,
  NetworkStubAdapter,
  isNetworkConfigured,
} from './network-stub.js';
export type { NetworkAdapterOptions } from './network-stub.js';
export { creativeServesRegion } from './regions.js';
export { demandResponse, describeError, latencySince, safeNow } from './response.js';
export type { Clock } from './response.js';
export {
  MAX_CANDIDATES,
  compareByRevenue,
  compareIds,
  matchScore,
  mediationScore,
  rankCandidates,
} from './select.js';
export { DEFAULT_DEMAND_TIMEOUT_MS } from './types.js';
export type { DemandAdapter, DemandFetchOptions, DirectAdapterOptions } from './types.js';
