import { z } from 'zod';

import { Classification } from './classification.js';
import { AppId, CreativeId, Surface, User } from './common.js';
import { DemandSource } from './creative.js';
import { AdvertiserDomain, AffiliateNetwork, PolicyRegion } from './policy-parts.js';

/**
 * Demand-side shapes (docs/BUILD_GUIDE.md Phase 3): the stored creative catalog, what the
 * gateway asks a demand adapter for, and what an adapter answers. None of them carries message
 * text: adapters see the classification and, optionally, dictionary keywords only.
 */

/**
 * A taxonomy category (software.devtools.database) or a trailing-wildcard pattern
 * (software.devtools.*) that matches every deeper category and nothing else.
 */
export const TARGET_CATEGORY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*(\.\*)?$/;

export const TargetCategory = z.string().regex(TARGET_CATEGORY_PATTERN).meta({
  title: 'TargetCategory',
  description:
    'A content category such as software.devtools.database, or a trailing-wildcard pattern such as software.devtools.* that matches every deeper category.',
});
export type TargetCategory = z.infer<typeof TargetCategory>;

const Keyword = z
  .string()
  .min(1)
  .describe('A dictionary term matched case-insensitively on whole words. Never message text.');

export const CatalogCreative = z
  .object({
    id: CreativeId,
    advertiser: z.string().min(1).describe('Advertiser display name.'),
    advertiser_domain: AdvertiserDomain.describe(
      'Advertiser domain, e.g. exampledb.dev. Matched against policy competitor_exclusions.',
    ),
    headline: z.string().min(1),
    body: z.string(),
    cta: z.string().min(1).describe('Call-to-action label.'),
    url_template: z
      .string()
      .min(1)
      .describe(
        'Destination URL. Affiliate entries may contain placeholders such as {{program_id}} that the affiliate adapter fills in.',
      ),
    target_categories: z
      .array(TargetCategory)
      .describe('Categories the creative targets. An empty list matches no category.'),
    target_regions: z
      .array(PolicyRegion)
      .describe('ISO 3166-1 alpha-2 codes or the token EU. An empty list means every region.'),
    keywords: z
      .array(Keyword)
      .describe('Dictionary terms that raise targeting_match when the request carries them.'),
    ecpm: z
      .number()
      .min(0)
      .describe('Expected revenue per thousand impressions, in currency units.'),
    source: DemandSource,
    active: z.boolean().describe('Inactive creatives are never returned by any adapter.'),
    network: AffiliateNetwork.optional().describe('Affiliate entries only.'),
    program_id: z
      .string()
      .min(1)
      .optional()
      .describe('Affiliate entries only: the app owner’s own program or tracking id.'),
  })
  .meta({
    title: 'CatalogCreative',
    description:
      'A creative as stored in the catalog (creatives table, dashboard, seed file plus id).',
  });
export type CatalogCreative = z.infer<typeof CatalogCreative>;

export const SeedCreative = CatalogCreative.omit({ id: true }).meta({
  title: 'SeedCreative',
  description:
    'A catalog creative before an id is assigned: the shape of examples/creatives.seed.json entries.',
});
export type SeedCreative = z.infer<typeof SeedCreative>;

export const DemandUser = User.pick({ region: true, locale: true }).meta({
  title: 'DemandUser',
  description: 'The user fields a demand adapter may see. Never the tier or user_hash.',
});
export type DemandUser = z.infer<typeof DemandUser>;

export const DemandRequest = z
  .object({
    app_id: AppId,
    classification: Classification,
    surface: Surface,
    user: DemandUser,
    exclusions: z
      .array(AdvertiserDomain)
      .describe(
        'Advertiser domains that must not be selected (policy competitor_exclusions). Mediation enforces them; adapters receive them so they can skip work.',
      ),
    keywords: z
      .array(Keyword)
      .optional()
      .describe(
        'Normalized dictionary terms the rules classifier matched (never raw message text). Adapters use them for keyword overlap.',
      ),
  })
  .meta({
    title: 'DemandRequest',
    description: 'What the gateway hands every demand adapter for one evaluation.',
  });
export type DemandRequest = z.infer<typeof DemandRequest>;

export const Candidate = CatalogCreative.extend({
  ecpm_estimate: z
    .number()
    .min(0)
    .describe('The adapter’s revenue estimate for this impression. Direct: the creative ecpm.'),
  targeting_match: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'How well the creative fits the classification; 1 is an exact category match with full keyword overlap.',
    ),
  resolved_url: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Destination URL once the adapter resolved url_template. The click redirect uses it when present.',
    ),
}).meta({
  title: 'Candidate',
  description: 'A catalog creative an adapter proposes for this turn, with its scores.',
});
export type Candidate = z.infer<typeof Candidate>;

export const DemandResponse = z
  .object({
    source: DemandSource,
    candidates: z.array(Candidate).describe('Best candidates first. Empty on failure.'),
    latency_ms: z.number().int().min(0),
    error: z
      .string()
      .min(1)
      .optional()
      .describe('Set when the adapter failed, timed out or was aborted. Never message text.'),
  })
  .meta({
    title: 'DemandResponse',
    description: 'One demand adapter’s answer; summarized into the audit record demand block.',
  });
export type DemandResponse = z.infer<typeof DemandResponse>;
