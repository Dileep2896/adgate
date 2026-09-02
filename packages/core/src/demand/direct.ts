import type { Candidate, CatalogCreative, DemandRequest, DemandResponse } from '@adgate/schemas';

import { normalizeKeywords } from './keywords.js';
import { targetingScore } from './match.js';
import { creativeServesRegion } from './regions.js';
import type { DemandAdapter, DemandFetchOptions, DirectAdapterOptions } from './types.js';

/**
 * DirectAdapter: the app's own creatives, handed in as an in-memory catalog (the gateway loads
 * them from Postgres). Pure and synchronous, so timeoutMs is never exceeded. Selection:
 * active direct creatives only, region filter, category match required, ranked by
 * targeting_match then ecpm then id, top DIRECT_MAX_CANDIDATES. competitor_exclusions are
 * NOT applied here: mediation drops excluded advertisers so the audit trace can record them.
 */
export const DIRECT_MAX_CANDIDATES = 3;

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** targeting_match desc, ecpm_estimate desc, id asc: total and deterministic. */
export const compareCandidates = (a: Candidate, b: Candidate): number =>
  b.targeting_match - a.targeting_match ||
  b.ecpm_estimate - a.ecpm_estimate ||
  compareIds(a.id, b.id);

export const selectDirectCandidates = (
  catalog: readonly CatalogCreative[],
  req: DemandRequest,
): Candidate[] => {
  const requestKeywords = normalizeKeywords(req.keywords ?? []);
  const candidates: Candidate[] = [];
  for (const creative of catalog) {
    if (!creative.active || creative.source !== 'direct') {
      continue;
    }
    if (!creativeServesRegion(creative.target_regions, req.user.region)) {
      continue;
    }
    const { score } = targetingScore(creative, req.classification, requestKeywords);
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
  return candidates.sort(compareCandidates).slice(0, DIRECT_MAX_CANDIDATES);
};

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'unknown error';

export class DirectAdapter implements DemandAdapter {
  readonly source = 'direct' as const;
  private readonly catalog: readonly CatalogCreative[];
  private readonly now: () => number;

  constructor(catalog: readonly CatalogCreative[], options: DirectAdapterOptions = {}) {
    this.catalog = [...catalog];
    this.now = options.now ?? Date.now;
  }

  async fetch(req: DemandRequest, opts: DemandFetchOptions): Promise<DemandResponse> {
    const start = this.safeNow();
    try {
      if (opts.signal?.aborted) {
        return this.respond([], start, 'aborted');
      }
      return this.respond(selectDirectCandidates(this.catalog, req), start);
    } catch (error) {
      return this.respond([], start, describeError(error));
    }
  }

  private safeNow(): number {
    try {
      return this.now();
    } catch {
      return Number.NaN;
    }
  }

  private respond(candidates: Candidate[], start: number, error?: string): DemandResponse {
    const elapsed = Math.round(this.safeNow() - start);
    const latency_ms = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    return error === undefined
      ? { source: this.source, candidates, latency_ms }
      : { source: this.source, candidates, latency_ms, error };
  }
}

export const createDirectAdapter = (
  catalog: readonly CatalogCreative[],
  options?: DirectAdapterOptions,
): DirectAdapter => new DirectAdapter(catalog, options);
