import { CATEGORIES_TAXONOMY, SENSITIVE_TAXONOMY, type SensitiveCategory } from '@adgateio/schemas';

import { RULES_DATA } from './data/index.js';
import { compilePatterns, type CompiledPattern } from './match.js';
import { normalizeText } from './normalize.js';
import type { CommercialCategory } from './types.js';

/**
 * The keyword data compiled for matching: phrases normalized and de-duplicated, patterns
 * compiled, intent weights resolved. Built once at module init from RULES_DATA. Iteration
 * order follows the taxonomies so results are deterministic and taxonomy-ordered.
 */
export const COMMERCIAL_CATEGORIES: readonly CommercialCategory[] = CATEGORIES_TAXONOMY.filter(
  (category): category is CommercialCategory => category !== 'general',
);

const phrases = (list: readonly string[]): string[] => [
  ...new Set(list.map(normalizeText).filter((phrase) => phrase !== '')),
];

export interface CompiledSensitiveRules {
  category: SensitiveCategory;
  strong: readonly string[];
  weak: readonly string[];
  patterns: readonly CompiledPattern[];
  /** Masked out of the text before this category is matched (see SensitiveRuleSet). */
  exclusions: readonly string[];
}

export interface CompiledCommercialRules {
  category: CommercialCategory;
  products: readonly string[];
  topics: readonly string[];
  patterns: readonly CompiledPattern[];
}

export interface CompiledIntentPhrase {
  phrase: string;
  weight: number;
}

export interface CompiledIntentPattern extends CompiledPattern {
  weight: number;
}

export const SENSITIVE_REGISTRY: readonly CompiledSensitiveRules[] = SENSITIVE_TAXONOMY.map(
  (category) => {
    const rules = RULES_DATA.sensitive[category];
    return {
      category,
      strong: phrases(rules.strong),
      weak: phrases(rules.weak),
      patterns: compilePatterns(rules.patterns),
      exclusions: phrases(rules.exclusions ?? []),
    };
  },
);

export const COMMERCIAL_REGISTRY: readonly CompiledCommercialRules[] = COMMERCIAL_CATEGORIES.map(
  (category) => {
    const rules = RULES_DATA.commercial[category];
    return {
      category,
      products: phrases(rules.products),
      topics: phrases(rules.topics),
      patterns: compilePatterns(rules.patterns),
    };
  },
);

const weightOf = (weight: keyof typeof RULES_DATA.scoring.intent.weights): number =>
  RULES_DATA.scoring.intent.weights[weight];

export const INTENT_PHRASES: readonly CompiledIntentPhrase[] = RULES_DATA.intent.phrases.map(
  ({ phrase, weight }) => ({ phrase: normalizeText(phrase), weight: weightOf(weight) }),
);

export const INTENT_PATTERNS: readonly CompiledIntentPattern[] = RULES_DATA.intent.patterns.map(
  ({ source, weight }) => ({ source, regex: new RegExp(source), weight: weightOf(weight) }),
);

export const INFORMATIONAL_PHRASES: readonly string[] = phrases(RULES_DATA.informational);
