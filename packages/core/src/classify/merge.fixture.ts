import type { Classification, ContentCategory, SensitiveCategory } from '@adgateio/schemas';

import { fakeLlmSuccess, type LlmClassificationFields } from './llm/fake.js';
import type { CommercialMatch, RulesResult, SensitiveMatch } from './rules/types.js';
import { RULES_VERSION } from './rules/version.js';
import type { ClassifyPolicy } from './types.js';

/**
 * Hand-built stage results for the mergeClassifications tests (a non-test module, because
 * importing a *.test.ts re-registers its tests). Shared by merge.test.ts, which covers the
 * sensitive-flag rules, and merge-confidence.test.ts, which covers the corroboration rule.
 */
export const strict: ClassifyPolicy = { sensitive_detection: 'strict', min_confidence: 0.7 };
export const balanced: ClassifyPolicy = { sensitive_detection: 'balanced', min_confidence: 0.7 };

export const sensitiveMatch = (
  category: SensitiveCategory,
  strength: 'strong' | 'weak',
  flagged = true,
): SensitiveMatch => ({ category, strength, terms: ['term'], flagged });

export const commercialMatch = (
  category: ContentCategory & `${string}.${string}`,
): CommercialMatch => ({
  category,
  strength: 'topic',
  score: 0.5,
  terms: ['postgres'],
});

export interface RulesFields {
  commercial_intent?: number;
  confidence?: number;
  sensitive?: SensitiveMatch[];
  commercial?: CommercialMatch[];
}

/** A RulesResult whose `sensitive` and `categories` follow from the matches it is given. */
export const rules = (fields: RulesFields = {}): RulesResult => {
  const sensitive = fields.sensitive ?? [];
  const commercial = fields.commercial ?? [];
  return {
    commercial_intent: fields.commercial_intent ?? 0,
    categories: commercial.length > 0 ? commercial.map((match) => match.category) : ['general'],
    sensitive: sensitive.filter((match) => match.flagged).map((match) => match.category),
    confidence: fields.confidence ?? 0.3,
    method: 'rules',
    prompt_version: RULES_VERSION,
    matches: { sensitive, commercial, intent: [], informational: [] },
  };
};

/** An LLM answer; unspecified fields default to a confident, general, serve-able one. */
export const llm = (fields: Partial<LlmClassificationFields>): Classification =>
  fakeLlmSuccess(fields).classification;
