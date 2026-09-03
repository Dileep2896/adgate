import type {
  AffiliateConfig,
  AffiliateNetwork,
  Candidate,
  CatalogCreative,
  DemandRequest,
  DemandResponse,
} from '@adgate/schemas';

import { normalizeKeywords } from '../keywords.js';
import { type Clock, demandResponse, describeError, latencySince, safeNow } from '../response.js';
import { MAX_CANDIDATES, matchScore, rankCandidates } from '../select.js';
import type { DemandAdapter, DemandFetchOptions } from '../types.js';
import { AFFILIATE_NOT_CONFIGURED, buildAffiliateUrl, isAffiliateConfigured } from './registry.js';
import type { AffiliateAdapterOptions } from './types.js';

/**
 * AffiliateAdapter: catalog creatives with source 'affiliate', served as tracked links built
 * from url_template and THE APP OWNER'S OWN AFFILIATE ACCOUNT (docs/decisions.md item 6). The
 * owner supplies AffiliateConfig (public program ids and tags, never credentials), commissions
 * are the owner's, and adgate runs no payout infrastructure and never calls a network. Pure and
 * synchronous like DirectAdapter, so timeoutMs cannot be exceeded.
 *
 * One adapter per affiliate demand entry in the policy: it serves creatives whose `network` is
 * its own, plus creatives without a `network` (the seed file's entry), which belong to whichever
 * network the policy names. Selection and ranking are DirectAdapter's (select.ts: revenue
 * order, the same compareByRevenue mediation ranks with). A creative
 * whose template cannot be built is skipped and named in `error` as
 * build_failed:<id>:<reason>; the ones that did build are still returned. No config entry for
 * the network means no candidates and error 'affiliate_not_configured'. Competitor exclusions
 * stay with mediation, as for every adapter.
 */
export const AFFILIATE_MAX_CANDIDATES = MAX_CANDIDATES;

/** Cap on the joined build_failed list so a large broken catalog cannot bloat the audit trace. */
const MAX_ERROR_LENGTH = 200;

/** {{u}} / {{destination}} when the catalog names no destination: the advertiser's landing page. */
export const defaultDestination = (creative: Pick<CatalogCreative, 'advertiser_domain'>): string =>
  `https://${creative.advertiser_domain}/`;

export interface AffiliateSelection {
  candidates: Candidate[];
  /** build_failed:<id>:<reason>, one per eligible creative whose template could not be built. */
  failures: string[];
}

export const selectAffiliateCandidates = (
  catalog: readonly CatalogCreative[],
  req: DemandRequest,
  network: AffiliateNetwork,
  config: AffiliateConfig,
): AffiliateSelection => {
  const requestKeywords = normalizeKeywords(req.keywords ?? []);
  const candidates: Candidate[] = [];
  const failures: string[] = [];
  for (const creative of catalog) {
    if (creative.source !== 'affiliate' || (creative.network ?? network) !== network) {
      continue;
    }
    const score = matchScore(creative, req, requestKeywords);
    if (score <= 0) {
      continue;
    }
    const built = buildAffiliateUrl({
      network,
      template: creative.url_template,
      config,
      destination: defaultDestination(creative),
      program_id: creative.program_id,
    });
    if (!built.ok) {
      failures.push(`build_failed:${creative.id}:${built.error}`);
      continue;
    }
    candidates.push({
      ...creative,
      ecpm_estimate: creative.ecpm,
      targeting_match: score,
      resolved_url: built.url,
    });
  }
  return { candidates: rankCandidates(candidates, AFFILIATE_MAX_CANDIDATES), failures };
};

export class AffiliateAdapter implements DemandAdapter {
  readonly source = 'affiliate' as const;
  private readonly catalog: readonly CatalogCreative[];
  private readonly network: AffiliateNetwork;
  private readonly config: AffiliateConfig;
  private readonly now: Clock;

  constructor(options: AffiliateAdapterOptions) {
    this.catalog = [...options.catalog];
    this.network = options.network;
    this.config = structuredClone(options.config);
    this.now = options.now ?? Date.now;
  }

  async fetch(req: DemandRequest, opts: DemandFetchOptions): Promise<DemandResponse> {
    const start = safeNow(this.now);
    try {
      if (opts.signal?.aborted) {
        return this.respond([], start, 'aborted');
      }
      if (!isAffiliateConfigured(this.config, this.network)) {
        return this.respond([], start, AFFILIATE_NOT_CONFIGURED);
      }
      const { candidates, failures } = selectAffiliateCandidates(
        this.catalog,
        req,
        this.network,
        this.config,
      );
      const error =
        failures.length === 0 ? undefined : failures.join(',').slice(0, MAX_ERROR_LENGTH);
      return this.respond(candidates, start, error);
    } catch (error) {
      return this.respond([], start, describeError(error));
    }
  }

  private respond(candidates: Candidate[], start: number, error?: string): DemandResponse {
    return demandResponse(this.source, candidates, latencySince(this.now, start), error);
  }
}

export const createAffiliateAdapter = (options: AffiliateAdapterOptions): AffiliateAdapter =>
  new AffiliateAdapter(options);
