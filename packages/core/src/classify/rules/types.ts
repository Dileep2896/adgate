import type { Classification, ContentCategory, SensitiveCategory } from '@adgateio/schemas';

/**
 * Types for the rules classifier. The keyword data under ./data is plain TS constants of these
 * shapes so it can be hashed into RULES_VERSION (canonical JSON) and extended by adding a file.
 * Every phrase in the data is written in normalized form (see normalize.ts); regex patterns are
 * stored as source strings and compiled once at module init.
 */
export type CommercialCategory = Exclude<ContentCategory, 'general'>;

export interface SensitiveRuleSet {
  category: SensitiveCategory;
  /** A single hit flags the category with confidence >= 0.9. */
  strong: readonly string[];
  /** Flags only when weak_hits_to_flag distinct weak phrases match; one alone is a hint. */
  weak: readonly string[];
  /** Regex sources matched against the normalized text; a hit counts as strong. */
  patterns: readonly string[];
  /**
   * Normalized phrases masked out of the text before this category's lists and patterns are
   * matched: compounds that contain a term but are not the topic (a glue gun is a tool, not a
   * weapon). A term elsewhere in the same text still matches.
   */
  exclusions?: readonly string[];
}

export interface CommercialRuleSet {
  category: CommercialCategory;
  /** Purchasable products or services: a hit alone signals a buying context. */
  products: readonly string[];
  /** Contextual vocabulary: places the conversation in the category, weak intent evidence. */
  topics: readonly string[];
  /** Regex sources matched against the normalized text; a hit counts as a product hit. */
  patterns: readonly string[];
}

export type IntentWeight = 'strong' | 'medium' | 'weak';

export interface IntentPhrase {
  phrase: string;
  weight: IntentWeight;
}

export interface IntentPattern {
  source: string;
  weight: IntentWeight;
}

export interface IntentRules {
  phrases: readonly IntentPhrase[];
  patterns: readonly IntentPattern[];
}

export interface RulesScoring {
  intent: {
    weights: Record<IntentWeight, number>;
    /** Noisy-OR weight added when any commercial product phrase or pattern matches. */
    product_hit: number;
    /** Noisy-OR weight added when only topic phrases match. */
    topic_hit: number;
    /** Subtracted per distinct informational phrase (explain, how do i, ...). */
    informational_penalty: number;
  };
  category: {
    product_weight: number;
    topic_weight: number;
  };
  confidence: {
    base: number;
    per_evidence: number;
    product_bonus: number;
    max: number;
  };
  sensitive: {
    strong: number;
    corroborated: number;
    weak: number;
    weak_hits_to_flag: number;
    max_intent: number;
  };
}

export interface RulesData {
  sensitive: Record<SensitiveCategory, SensitiveRuleSet>;
  commercial: Record<CommercialCategory, CommercialRuleSet>;
  intent: IntentRules;
  informational: readonly string[];
  aliases: Readonly<Record<string, string>>;
  scoring: RulesScoring;
}

export type SensitiveStrength = 'strong' | 'weak';

export interface SensitiveMatch {
  category: SensitiveCategory;
  /** The strongest evidence found. */
  strength: SensitiveStrength;
  /** Matched phrases and pattern sources (dictionary terms, never message text). */
  terms: string[];
  /** False when a single weak phrase matched: reported as a hint, not in `sensitive`. */
  flagged: boolean;
}

export type CommercialStrength = 'product' | 'topic';

export interface CommercialMatch {
  category: CommercialCategory;
  strength: CommercialStrength;
  /** product hits * product_weight + topic hits * topic_weight; orders `categories`. */
  score: number;
  terms: string[];
}

export interface RulesMatches {
  sensitive: SensitiveMatch[];
  commercial: CommercialMatch[];
  intent: string[];
  informational: string[];
}

/**
 * A full Classification (method 'rules', prompt_version RULES_VERSION) plus the match details
 * behind it. Callers that persist the classification should drop `matches`
 * (`const { matches, ...classification } = result`); Classification.parse also strips it.
 */
export interface RulesResult extends Classification {
  method: 'rules';
  matches: RulesMatches;
}
