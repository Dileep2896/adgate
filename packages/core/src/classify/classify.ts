import type { Classification } from '@adgate/schemas';

import { keywordsFromRulesMatches } from '../demand/keywords.js';
import { classifyCacheKey } from './cache.js';
import { DEFAULT_LLM_TIMEOUT_MS, type LlmClassifyResult } from './llm/types.js';
import { mergeClassifications, strongSensitiveFlags } from './merge.js';
import { prepareText, type PreparedText } from './prepare.js';
import { classifyByRules } from './rules/classify.js';
import type { RulesResult } from './rules/types.js';
import { RULES_VERSION } from './rules/version.js';
import type {
  ClassifyDeps,
  ClassifyInput,
  ClassifyLlmFailure,
  ClassifyOutcome,
  ClassifySource,
} from './types.js';

/**
 * The two-stage classifier (docs/BUILD_GUIDE.md Phase 2). Flow: prepare the text, run the rules
 * (always: they are cheap and their matched dictionary terms become the demand keywords), look
 * the text up in the cache, short-circuit on a strong sensitive hit, otherwise ask the LLM
 * (under the orchestrator's own deadline) and merge. Any LLM failure, a missing LLM, or
 * anything thrown inside (a broken cache included) degrades to a rules-only classification; if
 * not even the rules can run, the result is the zeroed fail-closed classification. classify()
 * itself never throws and never rejects. Blank input never reaches the LLM (nothing to
 * classify; rules give the base confidence, which the policy engine suppresses). Rules-only
 * fallbacks are not cached so a transient LLM failure cannot pin a weaker answer for the whole
 * TTL; short-circuit and merged results are.
 */
export const failClosedClassification = (): Classification => ({
  commercial_intent: 0,
  categories: ['general'],
  sensitive: [],
  confidence: 0,
  method: 'rules',
  prompt_version: RULES_VERSION,
});

const cloneClassification = (classification: Classification): Classification => ({
  ...classification,
  categories: [...classification.categories],
  sensitive: [...classification.sensitive],
});

/** The rules result as a plain Classification: `matches` never leaves the classifier. */
const rulesClassification = (rules: RulesResult): Classification => ({
  commercial_intent: rules.commercial_intent,
  categories: [...rules.categories],
  sensitive: [...rules.sensitive],
  confidence: rules.confidence,
  method: 'rules',
  prompt_version: rules.prompt_version,
});

/** Demand keywords from the rules matches: dictionary terms only, none when rules did not run. */
const keywordsOf = (rules: RulesResult | undefined): string[] => {
  try {
    return rules === undefined ? [] : keywordsFromRulesMatches(rules.matches);
  } catch {
    return [];
  }
};

/** The name of a thrown value and nothing else: a message could quote the conversation. */
const errorName = (error: unknown): string =>
  error instanceof Error && error.name !== '' ? error.name : 'NonError';

/**
 * Settles with a timeout failure when the classifier has not answered within timeoutMs. The
 * timer is cleared whichever side wins, so nothing keeps the event loop alive afterwards.
 */
const withDeadline = (
  pending: Promise<LlmClassifyResult>,
  timeoutMs: number,
): Promise<LlmClassifyResult> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<LlmClassifyResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        reason: 'timeout',
        latency_ms: timeoutMs,
        detail: `no answer within ${timeoutMs} ms`,
      });
    }, timeoutMs);
  });
  return Promise.race([pending, expired]).finally(() => {
    clearTimeout(timer);
  });
};

interface Run {
  prepared: PreparedText | undefined;
  cacheKey: string;
  rules: RulesResult | undefined;
}

/** Rules-only result for the catch path: the rules already computed, else computed now. */
const recoverRules = (run: Run): Classification => {
  try {
    if (run.prepared === undefined) {
      return failClosedClassification();
    }
    return rulesClassification(run.rules ?? classifyByRules(run.prepared.rulesText));
  } catch {
    return failClosedClassification();
  }
};

const classifyOrThrow = async (
  input: ClassifyInput,
  deps: ClassifyDeps,
): Promise<ClassifyOutcome> => {
  const now = deps.now ?? Date.now;
  const started = now();
  const run: Run = { prepared: undefined, cacheKey: '', rules: undefined };

  const finish = (
    classification: Classification,
    source: ClassifySource,
    llmFailure?: ClassifyLlmFailure,
    thrown?: unknown,
  ): ClassifyOutcome => ({
    classification,
    source,
    ...(llmFailure === undefined ? {} : { llm_failure: llmFailure }),
    ...(llmFailure === 'thrown' ? { error_name: errorName(thrown) } : {}),
    keywords: keywordsOf(run.rules),
    cache_key: run.cacheKey,
    latency_ms: Math.max(0, Math.round(now() - started)),
  });

  try {
    run.prepared = prepareText(input);
    run.cacheKey = classifyCacheKey(run.prepared.text, deps.policy);
    run.rules = classifyByRules(run.prepared.rulesText);

    const hit = deps.cache?.get(run.cacheKey);
    if (hit !== undefined) {
      return finish({ ...cloneClassification(hit), method: 'cached' }, 'cache');
    }

    if (strongSensitiveFlags(run.rules).length > 0) {
      const classification = rulesClassification(run.rules);
      deps.cache?.set(run.cacheKey, cloneClassification(classification));
      return finish(classification, 'rules_short_circuit');
    }

    if (run.prepared.rulesText.trim() === '') {
      return finish(rulesClassification(run.rules), 'rules_fallback', 'empty_input');
    }
    if (deps.llm === null) {
      return finish(rulesClassification(run.rules), 'rules_fallback', 'unavailable');
    }
    const result = await withDeadline(
      deps.llm.classify(run.prepared.text, { signal: deps.signal }),
      deps.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
    );
    if (!result.ok) {
      return finish(rulesClassification(run.rules), 'rules_fallback', result.reason);
    }

    const merged = mergeClassifications({
      rules: run.rules,
      llm: result.classification,
      policy: deps.policy,
    });
    deps.cache?.set(run.cacheKey, cloneClassification(merged));
    return finish(merged, 'merged');
  } catch (error) {
    return finish(recoverRules(run), 'rules_fallback', 'thrown', error);
  }
};

export const classify = async (
  input: ClassifyInput,
  deps: ClassifyDeps,
): Promise<ClassifyOutcome> => {
  try {
    return await classifyOrThrow(input, deps);
  } catch (error) {
    // Last resort (a throwing clock, a deps object that is not an object): fail closed.
    return {
      classification: failClosedClassification(),
      source: 'rules_fallback',
      llm_failure: 'thrown',
      error_name: errorName(error),
      keywords: [],
      cache_key: '',
      latency_ms: 0,
    };
  }
};
