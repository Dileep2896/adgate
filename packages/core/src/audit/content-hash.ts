import type { CatalogCreative, Sha256Hash } from '@adgate/schemas';

import { canonicalize } from '../canonical/canonicalize.js';
import { sha256Prefixed } from './crypto.js';

/**
 * `creative.content_hash` of an audit record (docs/audit.md): sha256 over the canonical JSON of
 * the creative CONTENT, the six fields that decide what the user sees and where a click goes.
 * Identity (id), targeting, pricing, status and per-request values (ecpm_estimate,
 * targeting_match, resolved_url) are left out on purpose: the verification check
 * `creative_hash` recomputes this over the stored creatives row and compares, so the hash must
 * be stable for as long as the copy and destination are unchanged.
 */
export const CREATIVE_CONTENT_FIELDS = [
  'advertiser',
  'advertiser_domain',
  'headline',
  'body',
  'cta',
  'url_template',
] as const;

export type CreativeContent = Pick<CatalogCreative, (typeof CREATIVE_CONTENT_FIELDS)[number]>;

/** Exactly the six content fields of a creative (a Candidate or a catalog row), in this order. */
export const creativeContent = (creative: CreativeContent): CreativeContent => ({
  advertiser: creative.advertiser,
  advertiser_domain: creative.advertiser_domain,
  headline: creative.headline,
  body: creative.body,
  cta: creative.cta,
  url_template: creative.url_template,
});

export const creativeContentHash = (creative: CreativeContent): Sha256Hash =>
  sha256Prefixed(canonicalize(creativeContent(creative)));
