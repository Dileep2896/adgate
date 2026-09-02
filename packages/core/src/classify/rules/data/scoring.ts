import type { RulesScoring } from '../types.js';

/**
 * Scoring constants. Part of RULES_DATA, so changing any of them changes RULES_VERSION.
 * Calibrated against fixtures/classify-fixtures.json (see fixtures.test.ts):
 * - a product phrase alone gives intent 0.7 (a bare "robot vacuum that handles pet hair" is a
 *   buying context), a topic phrase alone 0.2 (talking about postgres is not shopping);
 * - intent phrases combine by noisy-OR with the category signal;
 * - a strong sensitive hit reports confidence 0.9 (0.95 when corroborated by a second term) so
 *   the policy engine suppresses on rules alone, and caps commercial intent at 0.2.
 */
export const SCORING: RulesScoring = {
  intent: {
    weights: { strong: 0.45, medium: 0.3, weak: 0.15 },
    product_hit: 0.7,
    topic_hit: 0.2,
    informational_penalty: 0.15,
  },
  category: {
    product_weight: 1,
    topic_weight: 0.5,
  },
  confidence: {
    base: 0.3,
    per_evidence: 0.15,
    product_bonus: 0.15,
    max: 0.95,
  },
  sensitive: {
    strong: 0.9,
    corroborated: 0.95,
    weak: 0.75,
    weak_hits_to_flag: 2,
    max_intent: 0.2,
  },
};
