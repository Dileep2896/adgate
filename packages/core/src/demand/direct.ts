import type { Candidate, CatalogCreative, DemandRequest, DemandResponse } from '@adgate/schemas';

import { normalizeKeywords } from './keywords.js';
import { type Clock, demandResponse, describeError, latencySince, safeNow } from './response.js';
import { MAX_CANDIDATES, matchScore, rankCandidates } from './select.js';
import type { DemandAdapter, DemandFetchOptions, DirectAdapterOptions } from './types.js';

/**
 * DirectAdapter: the app's own creatives, handed in as an in-memory catalog (the gateway loads
 * them from Postgres). Pure and synchronous, so timeoutMs is never exceeded. Selection:
 * active direct creatives only, region filter, category match required, ranked by
 * targeting_match then ecpm then id (select.ts), top DIRECT_MAX_CANDIDATES. competitor_exclusions
 * are NOT applied here: mediation drops excluded advertisers so the audit trace can record them.
 */
export const DIRECT_MAX_CANDIDATES = MAX_CANDIDATES;

export const selectDirectCandidates = (
  catalog: readonly CatalogCreative[],
  req: DemandRequest,
): Candidate[] => {
  const requestKeywords = normalizeKeywords(req.keywords ?? []);
  const candidates: Candidate[] = [];
  for (const creative of catalog) {
    if (creative.source !== 'direct') {
      continue;
    }
    const score = matchScore(creative, req, requestKeywords);
    if (score <= 0) {
      continue;
    }
    candidates.push({
      ...creative,
      ecpm_estimate: creative.ecpm,
      targeting_match: score,
      // Direct URLs have no placeholders: the click redirect can use them as they are.
      resolved_url: creative.url_template,
    });
  }
  return rankCandidates(candidates, DIRECT_MAX_CANDIDATES);
};

export class DirectAdapter implements DemandAdapter {
  readonly source = 'direct' as const;
  private readonly catalog: readonly CatalogCreative[];
  private readonly now: Clock;

  constructor(catalog: readonly CatalogCreative[], options: DirectAdapterOptions = {}) {
    this.catalog = [...catalog];
    this.now = options.now ?? Date.now;
  }

  async fetch(req: DemandRequest, opts: DemandFetchOptions): Promise<DemandResponse> {
    const start = safeNow(this.now);
    try {
      if (opts.signal?.aborted) {
        return this.respond([], start, 'aborted');
      }
      return this.respond(selectDirectCandidates(this.catalog, req), start);
    } catch (error) {
      return this.respond([], start, describeError(error));
    }
  }

  private respond(candidates: Candidate[], start: number, error?: string): DemandResponse {
    return demandResponse(this.source, candidates, latencySince(this.now, start), error);
  }
}

export const createDirectAdapter = (
  catalog: readonly CatalogCreative[],
  options?: DirectAdapterOptions,
): DirectAdapter => new DirectAdapter(catalog, options);
