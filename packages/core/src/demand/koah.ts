import type { KoahConfig } from '@adgateio/schemas';

import { type NetworkAdapterOptions, NetworkStubAdapter } from './network-stub.js';

/**
 * KoahAdapter: the Koah demand source, a stub per docs/decisions.md item 10 ("Koah and Gravity
 * adapters are stubs until partner API access exists. Reason: do not build against guessed
 * request shapes."). It is a real DemandAdapter with source 'koah' that mediate() runs next to
 * the direct and affiliate adapters, and it never yields a candidate: disabled or missing
 * credentials -> error 'not_configured'; enabled with api_key and base_url -> error
 * 'not_implemented'. No network call, no credential kept on the instance (network-stub.ts).
 *
 * TODO (allowed by story S12, docs/decisions.md item 10): replace the not_implemented branch
 * with a Koah client once partner API access exists. Confirm every line below against the
 * partner documentation first; nothing here is a guess to build on.
 *
 *   Request, built from DemandRequest and sent to <base_url> with the api_key as a bearer token:
 *     app_id          DemandRequest.app_id
 *     categories      DemandRequest.classification.categories (taxonomy ids only; never message
 *                     text and never the sensitive list)
 *     region, locale  DemandRequest.user (never tier or user_hash)
 *     surface         DemandRequest.surface.type and placement (after_answer)
 *     max_candidates  at most MAX_CANDIDATES (select.ts), never above surface.max_creatives
 *     exclusions      DemandRequest.exclusions (advertiser domains that must not be returned)
 *   Response, mapped to Candidate[] (docs/BUILD_GUIDE.md Phase 3):
 *     per creative: id, advertiser, advertiser_domain, headline, body, cta, destination URL and
 *     target categories, plus ecpm_estimate (the partner's revenue estimate for this impression)
 *     and whatever is needed to derive targeting_match in [0, 1]. The click still goes through
 *     the gateway redirect: Creative.url is never the advertiser directly.
 *   Budget: opts.timeoutMs and opts.signal (DEFAULT_DEMAND_TIMEOUT_MS); every failure stays
 *   { candidates: [], error } and the adapter never rejects.
 *   Partner docs: TBD
 */
export class KoahAdapter extends NetworkStubAdapter<'koah'> {
  constructor(config: KoahConfig, options?: NetworkAdapterOptions) {
    super('koah', config, options);
  }
}

export const createKoahAdapter = (
  config: KoahConfig,
  options?: NetworkAdapterOptions,
): KoahAdapter => new KoahAdapter(config, options);
