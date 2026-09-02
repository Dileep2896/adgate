/**
 * Rules classifier: keyword and pattern lists per sensitive and commercial category, matched
 * over normalized text. Public surface of packages/core/src/classify/rules.
 */
export { classifyByRules } from './classify.js';
export { RULES_DATA } from './data/index.js';
export { containsPhrase } from './match.js';
export { normalizeText } from './normalize.js';
export { RULES_VERSION, computeRulesVersion } from './version.js';
export type {
  CommercialCategory,
  CommercialMatch,
  CommercialRuleSet,
  CommercialStrength,
  IntentPattern,
  IntentPhrase,
  IntentRules,
  IntentWeight,
  RulesData,
  RulesMatches,
  RulesResult,
  RulesScoring,
  SensitiveMatch,
  SensitiveRuleSet,
  SensitiveStrength,
} from './types.js';
