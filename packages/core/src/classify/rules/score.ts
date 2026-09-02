import { SCORING } from './data/scoring.js';
import type { CommercialStrength, SensitiveMatch } from './types.js';

/**
 * Scoring for the rules stage. Commercial intent combines independent signals with a
 * noisy-OR (1 - product of (1 - w)), so several weak signals add up but never exceed 1, then
 * subtracts a penalty per informational phrase. Confidence grows with the number of distinct
 * pieces of evidence. All outputs are rounded to three decimals inside [0, 1].
 */
export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export const noisyOr = (weights: readonly number[]): number =>
  1 - weights.reduce((acc, weight) => acc * (1 - clamp01(weight)), 1);

export interface CommercialEvidence {
  /** One weight per distinct matched intent phrase or pattern. */
  intentWeights: readonly number[];
  /** The strongest commercial category evidence, or null when no category matched. */
  categoryStrength: CommercialStrength | null;
  /** Distinct informational phrases (explain, how do i, ...). */
  informationalHits: number;
  /** Distinct matched terms across intent, category and informational lists. */
  evidenceCount: number;
}

export const scoreIntent = (evidence: CommercialEvidence): number => {
  const weights = [...evidence.intentWeights];
  if (evidence.categoryStrength === 'product') {
    weights.push(SCORING.intent.product_hit);
  } else if (evidence.categoryStrength === 'topic') {
    weights.push(SCORING.intent.topic_hit);
  }
  const penalty = evidence.informationalHits * SCORING.intent.informational_penalty;
  return round3(clamp01(noisyOr(weights) - penalty));
};

export const scoreConfidence = (evidence: CommercialEvidence): number => {
  const { base, per_evidence, product_bonus, max } = SCORING.confidence;
  const bonus = evidence.categoryStrength === 'product' ? product_bonus : 0;
  return round3(clamp01(Math.min(max, base + evidence.evidenceCount * per_evidence + bonus)));
};

/** Confidence in a sensitive verdict: the best evidence among the flagged categories. */
export const scoreSensitiveConfidence = (flagged: readonly SensitiveMatch[]): number => {
  let best = 0;
  for (const match of flagged) {
    const value =
      match.strength === 'weak'
        ? SCORING.sensitive.weak
        : match.terms.length >= 2
          ? SCORING.sensitive.corroborated
          : SCORING.sensitive.strong;
    best = Math.max(best, value);
  }
  return round3(clamp01(best));
};
