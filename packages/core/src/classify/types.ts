import type { Classification, EvaluateRequest, PolicyConfig } from '@adgate/schemas';

import type { LlmClassifier, LlmFailureReason } from './llm/types.js';

/**
 * Types for the classify() orchestrator (docs/BUILD_GUIDE.md Phase 2, design steps 3 to 5).
 * Everything the orchestrator needs from the outside world is injected through ClassifyDeps:
 * the LLM stage, the cache, the two policy fields that shape the merge, the clock and an
 * optional cancellation signal. Core never reads env, time or the network on its own.
 */

/** The EvaluateRequest fields the classifier reads. At least one is normally present. */
export type ClassifyInput = Pick<EvaluateRequest, 'messages' | 'context_summary'>;

/** The policy fields that change how rule and LLM signals are merged. */
export type ClassifyPolicy = Pick<PolicyConfig, 'sensitive_detection' | 'min_confidence'>;

/**
 * Swappable cache of final classifications keyed by classifyCacheKey(). createLruCache() is the
 * in-memory implementation; the gateway may put a Postgres-backed one here later. Implementations
 * should not throw: a throw is caught, but it degrades that request to a rules-only result.
 */
export interface ClassifyCache {
  get(key: string): Classification | undefined;
  set(key: string, value: Classification): void;
}

export interface ClassifyDeps {
  /** null when no LLM is configured: every turn is classified by rules alone. */
  llm: LlmClassifier | null;
  cache?: ClassifyCache | undefined;
  policy: ClassifyPolicy;
  /**
   * The orchestrator's own deadline on the LLM stage, in ms; an LlmClassifier that has not
   * settled by then is abandoned for a rules-only result (llm_failure 'timeout'). Defaults to
   * DEFAULT_LLM_TIMEOUT_MS. The OpenAI client has a timeout of its own; this one does not trust it.
   */
  timeoutMs?: number | undefined;
  /** Clock for latency_ms. Defaults to Date.now. */
  now?: (() => number) | undefined;
  /** Caller-side cancellation forwarded to the LLM stage. */
  signal?: AbortSignal | undefined;
}

export type ClassifySource = 'cache' | 'rules_short_circuit' | 'merged' | 'rules_fallback';

/**
 * Why the LLM did not contribute: one of the stage's own reasons, 'unavailable' when deps.llm
 * is null, 'empty_input' when the prepared text is blank, or 'thrown' when something inside
 * classify() threw and was converted to rules only.
 */
export type ClassifyLlmFailure = LlmFailureReason | 'thrown' | 'unavailable' | 'empty_input';

export interface ClassifyOutcome {
  /** Never carries rule match detail or message text; safe to persist and return. */
  classification: Classification;
  source: ClassifySource;
  /** Present only when source is 'rules_fallback'. */
  llm_failure?: ClassifyLlmFailure;
  /**
   * Present only with llm_failure 'thrown': the thrown Error's `name` (never its message, which
   * could quote input), so the gateway can log what broke without logging content.
   */
  error_name?: string;
  /**
   * The commercial dictionary terms the rules stage matched, normalized and de-duplicated
   * (keywordsFromRulesMatches): what the gateway hands demand adapters as DemandRequest.keywords.
   * Dictionary terms only, never message text. Present on every path, a cache hit included, so
   * a warm cache ranks creatives exactly like a cold one; empty when the rules could not run.
   */
  keywords: string[];
  /** classifyCacheKey() of the prepared text; empty only when the input could not be prepared. */
  cache_key: string;
  latency_ms: number;
}
