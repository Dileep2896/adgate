import type { ContentCategory, SensitiveCategory } from '@adgate/schemas';

import { SCORING } from './data/scoring.js';
import { findPatterns, findPhrases, maskPhrases, padText } from './match.js';
import { normalizeText } from './normalize.js';
import {
  COMMERCIAL_REGISTRY,
  INFORMATIONAL_PHRASES,
  INTENT_PATTERNS,
  INTENT_PHRASES,
  SENSITIVE_REGISTRY,
} from './registry.js';
import { scoreConfidence, scoreIntent, scoreSensitiveConfidence } from './score.js';
import type { CommercialMatch, CommercialStrength, RulesResult, SensitiveMatch } from './types.js';
import { RULES_VERSION } from './version.js';

/**
 * The rules stage of the classifier (docs/BUILD_GUIDE.md Phase 2, design step 1). Pure and
 * synchronous: normalize the already joined conversation text, match the keyword registry, and
 * score. Any sensitive hit caps commercial_intent at SCORING.sensitive.max_intent; self_harm
 * forces it to 0. A category's exclusions (compounds such as glue gun) are masked out before
 * that category is matched. Never throws on a string input; an empty or content-free text
 * yields intent 0, categories ['general'] and the base confidence.
 */
const matchSensitive = (padded: string): SensitiveMatch[] => {
  const matches: SensitiveMatch[] = [];
  for (const rules of SENSITIVE_REGISTRY) {
    // Excluded compounds (glue gun) are blanked out for this category only.
    const text = maskPhrases(padded, rules.exclusions);
    const strong = [
      ...findPhrases(text, rules.strong),
      ...findPatterns(text.trim(), rules.patterns),
    ];
    const weak = findPhrases(text, rules.weak);
    if (strong.length === 0 && weak.length === 0) {
      continue;
    }
    matches.push({
      category: rules.category,
      strength: strong.length > 0 ? 'strong' : 'weak',
      terms: [...strong, ...weak],
      flagged: strong.length > 0 || weak.length >= SCORING.sensitive.weak_hits_to_flag,
    });
  }
  return matches;
};

const matchCommercial = (normalized: string, padded: string): CommercialMatch[] => {
  const matches: CommercialMatch[] = [];
  for (const rules of COMMERCIAL_REGISTRY) {
    const products = [
      ...findPhrases(padded, rules.products),
      ...findPatterns(normalized, rules.patterns),
    ];
    const topics = findPhrases(padded, rules.topics);
    if (products.length === 0 && topics.length === 0) {
      continue;
    }
    matches.push({
      category: rules.category,
      strength: products.length > 0 ? 'product' : 'topic',
      score:
        products.length * SCORING.category.product_weight +
        topics.length * SCORING.category.topic_weight,
      terms: [...products, ...topics],
    });
  }
  // Stable sort: ties keep taxonomy order.
  return matches.sort((a, b) => b.score - a.score);
};

interface IntentHits {
  terms: string[];
  weights: number[];
}

const matchIntent = (normalized: string, padded: string): IntentHits => {
  const hits: IntentHits = { terms: [], weights: [] };
  for (const { phrase, weight } of INTENT_PHRASES) {
    if (padded.includes(` ${phrase} `)) {
      hits.terms.push(phrase);
      hits.weights.push(weight);
    }
  }
  for (const { source, regex, weight } of INTENT_PATTERNS) {
    if (regex.test(normalized)) {
      hits.terms.push(source);
      hits.weights.push(weight);
    }
  }
  return hits;
};

const strongestCommercial = (matches: readonly CommercialMatch[]): CommercialStrength | null => {
  if (matches.some((match) => match.strength === 'product')) {
    return 'product';
  }
  return matches.length > 0 ? 'topic' : null;
};

export const classifyByRules = (text: string): RulesResult => {
  const normalized = normalizeText(text);
  const padded = padText(normalized);

  const sensitive = matchSensitive(padded);
  const commercial = matchCommercial(normalized, padded);
  const intent = matchIntent(normalized, padded);
  const informational = findPhrases(padded, INFORMATIONAL_PHRASES);

  const categoryStrength = strongestCommercial(commercial);
  const evidence = {
    intentWeights: intent.weights,
    categoryStrength,
    informationalHits: informational.length,
    evidenceCount:
      intent.terms.length +
      commercial.reduce((count, match) => count + match.terms.length, 0) +
      informational.length,
  };

  let commercialIntent = scoreIntent(evidence);
  let confidence = scoreConfidence(evidence);

  const flagged = sensitive.filter((match) => match.flagged);
  const sensitiveCategories: SensitiveCategory[] = flagged.map((match) => match.category);
  if (flagged.length > 0) {
    confidence = scoreSensitiveConfidence(flagged);
    commercialIntent = sensitiveCategories.includes('self_harm')
      ? 0
      : Math.min(commercialIntent, SCORING.sensitive.max_intent);
  }

  const categories: ContentCategory[] =
    commercial.length > 0 ? commercial.map((match) => match.category) : ['general'];

  return {
    commercial_intent: commercialIntent,
    categories,
    sensitive: sensitiveCategories,
    confidence,
    method: 'rules',
    prompt_version: RULES_VERSION,
    matches: { sensitive, commercial, intent: intent.terms, informational },
  };
};
