/**
 * The two-stage classifier orchestrator: text preparation, cache, rules short circuit, LLM
 * and merge. Public surface of packages/core/src/classify (the rules and llm stages export
 * their own surfaces from ./rules and ./llm).
 */
export {
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  classifyCacheKey,
  createLruCache,
} from './cache.js';
export type { LruCache, LruCacheOptions } from './cache.js';
export { classify, failClosedClassification } from './classify.js';
export { mergeClassifications, rulesFired, strongSensitiveFlags } from './merge.js';
export type { MergeInput } from './merge.js';
export { DEFAULT_PREPARE_OPTIONS, prepareText } from './prepare.js';
export type { PrepareTextInput, PrepareTextOptions } from './prepare.js';
export type {
  ClassifyCache,
  ClassifyDeps,
  ClassifyInput,
  ClassifyLlmFailure,
  ClassifyOutcome,
  ClassifyPolicy,
  ClassifySource,
} from './types.js';
