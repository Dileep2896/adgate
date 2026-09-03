import type { Candidate, CatalogCreative, DemandRequest } from '@adgate/schemas';

import { targetingScore } from './match.js';
import { creativeServesRegion } from './regions.js';

/**
 * Selection rules every catalog-backed adapter shares (direct, affiliate): who is eligible and
 * how candidates are ordered. Each adapter still filters on its own source (and, for affiliate,
 * its network) and decides what resolved_url is. docs/decisions.md item 5: no auction, rank by
 * score; ties break deterministically so the same catalog always yields the same order.
 */

/** Candidates an adapter returns at most (BUILD_GUIDE Phase 3: "return top 3 with scores"). */
export const MAX_CANDIDATES = 3;

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** targeting_match desc, ecpm_estimate desc, id asc: total and deterministic. */
export const compareCandidates = (a: Candidate, b: Candidate): number =>
  b.targeting_match - a.targeting_match ||
  b.ecpm_estimate - a.ecpm_estimate ||
  compareIds(a.id, b.id);

/** A copy of `candidates` in compareCandidates order, cut to `max`. The input is untouched. */
export const rankCandidates = (
  candidates: readonly Candidate[],
  max: number = MAX_CANDIDATES,
): Candidate[] => [...candidates].sort(compareCandidates).slice(0, max);

/**
 * The targeting_match of one creative for one request, or 0 when the creative is not eligible:
 * inactive, not serving the user's region (empty target_regions = everywhere, EU expands, a
 * missing region fails closed for targeted creatives) or no category match. `requestKeywords`
 * should already be normalized (normalizeKeywords) so a catalog loop normalizes them once.
 */
export const matchScore = (
  creative: CatalogCreative,
  req: DemandRequest,
  requestKeywords: readonly string[],
): number => {
  if (!creative.active) {
    return 0;
  }
  if (!creativeServesRegion(creative.target_regions, req.user.region)) {
    return 0;
  }
  return targetingScore(creative, req.classification, requestKeywords).score;
};
