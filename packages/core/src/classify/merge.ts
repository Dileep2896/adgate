import { SENSITIVE_TAXONOMY, type Classification, type SensitiveCategory } from '@adgateio/schemas';

import { RULES_DATA } from './rules/data/index.js';
import type { RulesResult } from './rules/types.js';
import type { ClassifyPolicy } from './types.js';

/**
 * Merge of the rules and LLM stages (docs/BUILD_GUIDE.md Phase 2, design step 4). The LLM wins
 * on categories and commercial_intent. Sensitive flags (policy.sensitive_detection):
 * - every category the rules stage flagged (a strong phrase or pattern hit, or a pair of weak
 *   phrases) is kept in both modes: the rules are the deterministic floor;
 * - strict adds every LLM flag at any confidence (any signal from either stage suppresses);
 * - balanced adds the LLM's flags only when the LLM's confidence reaches policy.min_confidence,
 *   so an unsure model does not suppress on its own;
 * - self_harm from either stage is never dropped in either mode.
 *
 * CONFIDENCE. The LLM's, unless the rules fired (any sensitive flag or any commercial category
 * match), and then it depends on whether the two stages point the same way:
 * - they CORROBORATE each other (neither contradicts the other): max(rules, llm). Two
 *   independent stages reaching the same reading is evidence, so more evidence must not mean
 *   less confidence. Until 2026-09-07 this case also took min(rules, llm), which let a single
 *   weak category keyword veto a certain model: multi-turn product questions whose final turn
 *   names no product matched the rules at 0.6, and the merge dragged an LLM at 0.9 down to 0.6,
 *   under the default min_confidence of 0.7, so a correct classification suppressed as
 *   low-confidence (progress.txt, CLASSIFIER-MULTITURN and CLASSIFIER-CONFIDENCE).
 * - they CONFLICT (see stagesCorroborate): min(rules, llm), which is what the original rule was
 *   really protecting against. Neither stage has earned its own number when they disagree.
 * This is a confidence rule and nothing else. Merged confidence is an OUTPUT: mergeSensitive
 * reads the LLM's own confidence, never the merged value, so no confidence rule can add or drop
 * a sensitive flag, and raising confidence cannot make a flagged turn servable (a flagged
 * category is blocked by policy rule 3 whatever the confidence, and the cap below still applies).
 *
 * A non-empty sensitive list caps commercial_intent at the rules stage's cap (0.2) and self_harm
 * forces 0, mirroring classifyByRules. The result carries no rule match detail.
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

/**
 * The rules flagged a sensitive category the LLM did not name: the stages disagree about the one
 * thing that matters most. The flag is kept either way (the rules are the floor), but neither
 * stage has earned its own confidence while they contradict each other.
 */
const rulesSensitiveUnconfirmed = (rules: RulesResult, llm: Classification): boolean =>
  rules.sensitive.some((category) => !llm.sensitive.includes(category));

/**
 * The rules matched commercial categories and the LLM named none of them: the two stages read
 * the turn as being about different subjects, so the keyword match is evidence against the LLM's
 * reading rather than for it. Rules that matched no commercial category at all are not a
 * disagreement, they are silence.
 */
const commercialCategoriesDisjoint = (rules: RulesResult, llm: Classification): boolean =>
  rules.matches.commercial.length > 0 &&
  !rules.matches.commercial.some((match) => llm.categories.includes(match.category));

/**
 * True when the two stages point the same way: the LLM confirmed every sensitive category the
 * rules flagged, and shares at least one category with them whenever the rules named any. Both
 * halves have to hold; either contradiction alone is a conflict.
 */
export const stagesCorroborate = (rules: RulesResult, llm: Classification): boolean =>
  !rulesSensitiveUnconfirmed(rules, llm) && !commercialCategoriesDisjoint(rules, llm);

/** Merged confidence: see the CONFIDENCE paragraph in this module's header comment. */
const mergedConfidence = ({ rules, llm }: MergeInput): number => {
  if (!rulesFired(rules)) {
    return llm.confidence;
  }
  return stagesCorroborate(rules, llm)
    ? Math.max(rules.confidence, llm.confidence)
    : Math.min(rules.confidence, llm.confidence);
};

const inTaxonomyOrder = (values: Iterable<SensitiveCategory>): SensitiveCategory[] => {
  const present = new Set(values);
  return SENSITIVE_TAXONOMY.filter((category) => present.has(category));
};

const mergeSensitive = ({ rules, llm, policy }: MergeInput): SensitiveCategory[] => {
  const llmCounts =
    policy.sensitive_detection === 'strict' || llm.confidence >= policy.min_confidence;
  const fromLlm = llmCounts
    ? llm.sensitive
    : llm.sensitive.filter((category) => category === 'self_harm');
  return inTaxonomyOrder([...rules.sensitive, ...fromLlm]);
};

const cappedIntent = (intent: number, sensitive: readonly SensitiveCategory[]): number => {
  if (sensitive.includes('self_harm')) {
    return 0;
  }
  return sensitive.length > 0 ? Math.min(intent, SENSITIVE_INTENT_CAP) : intent;
};

export const mergeClassifications = (input: MergeInput): Classification => {
  const { llm } = input;
  const sensitive = mergeSensitive(input);
  return {
    commercial_intent: cappedIntent(llm.commercial_intent, sensitive),
    categories: [...llm.categories],
    sensitive,
    confidence: mergedConfidence(input),
    method: 'llm',
    prompt_version: llm.prompt_version,
  };
};
