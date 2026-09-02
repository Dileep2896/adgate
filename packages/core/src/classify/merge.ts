import { SENSITIVE_TAXONOMY, type Classification, type SensitiveCategory } from '@adgate/schemas';

import { RULES_DATA } from './rules/data/index.js';
import type { RulesResult } from './rules/types.js';
import type { ClassifyPolicy } from './types.js';

/**
 * Merge of the rules and LLM stages (docs/BUILD_GUIDE.md Phase 2, design step 4). The LLM wins
 * on categories and commercial_intent. Sensitive flags depend on policy.sensitive_detection:
 * - strict: the union of rules and LLM flags (any signal from either stage suppresses);
 * - balanced: strong rule flags (a strong phrase or pattern hit) plus the LLM's flags only when
 *   the LLM's confidence reaches policy.min_confidence, so weak-pair rule hits and unsure model
 *   flags do not suppress on their own.
 * Confidence is the LLM's unless rules fired (any sensitive flag or any commercial category
 * match), then min(rules, llm). A non-empty sensitive list caps commercial_intent at the rules
 * stage's cap (0.2) and self_harm forces 0, mirroring classifyByRules. The result carries no
 * rule match detail.
 */
export interface MergeInput {
  rules: RulesResult;
  llm: Classification;
  policy: ClassifyPolicy;
}

const SENSITIVE_INTENT_CAP = RULES_DATA.scoring.sensitive.max_intent;

/** Flagged categories backed by a strong phrase or pattern (rules confidence >= 0.9). */
export const strongSensitiveFlags = (rules: RulesResult): SensitiveCategory[] =>
  rules.matches.sensitive
    .filter((match) => match.flagged && match.strength === 'strong')
    .map((match) => match.category);

/** True when rules flagged a sensitive category or matched a commercial category. */
export const rulesFired = (rules: RulesResult): boolean =>
  rules.sensitive.length > 0 || rules.matches.commercial.length > 0;

const inTaxonomyOrder = (values: Iterable<SensitiveCategory>): SensitiveCategory[] => {
  const present = new Set(values);
  return SENSITIVE_TAXONOMY.filter((category) => present.has(category));
};

const mergeSensitive = ({ rules, llm, policy }: MergeInput): SensitiveCategory[] => {
  if (policy.sensitive_detection === 'strict') {
    return inTaxonomyOrder([...rules.sensitive, ...llm.sensitive]);
  }
  const fromLlm = llm.confidence >= policy.min_confidence ? llm.sensitive : [];
  return inTaxonomyOrder([...strongSensitiveFlags(rules), ...fromLlm]);
};

const cappedIntent = (intent: number, sensitive: readonly SensitiveCategory[]): number => {
  if (sensitive.includes('self_harm')) {
    return 0;
  }
  return sensitive.length > 0 ? Math.min(intent, SENSITIVE_INTENT_CAP) : intent;
};

export const mergeClassifications = (input: MergeInput): Classification => {
  const { rules, llm } = input;
  const sensitive = mergeSensitive(input);
  return {
    commercial_intent: cappedIntent(llm.commercial_intent, sensitive),
    categories: [...llm.categories],
    sensitive,
    confidence: rulesFired(rules) ? Math.min(rules.confidence, llm.confidence) : llm.confidence,
    method: 'llm',
    prompt_version: llm.prompt_version,
  };
};
