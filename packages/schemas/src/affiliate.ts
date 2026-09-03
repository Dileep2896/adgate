import { z } from 'zod';

/**
 * App-level affiliate configuration (docs/BUILD_GUIDE.md Phase 3, docs/decisions.md item 6).
 * Affiliate links use the APP OWNER'S OWN affiliate accounts: the caller supplies the ids that
 * identify those accounts and the affiliate adapter fills them into catalog url_templates.
 * adgate never holds payout details or account credentials; nothing here is a secret, only the
 * public identifiers that appear in tracked links. Strict objects: an unknown key is rejected
 * so a misspelled field cannot silently leave a network unconfigured.
 */

const programId = z.string().min(1);

export const PartnerStackConfig = z
  .strictObject({
    program_id: programId.describe(
      'The PartnerStack partner key or link id that appears in tracked links ({{program_id}}).',
    ),
  })
  .meta({
    title: 'PartnerStackConfig',
    description: 'The app owner’s PartnerStack identifiers. Never a credential.',
  });
export type PartnerStackConfig = z.infer<typeof PartnerStackConfig>;

export const ImpactConfig = z
  .strictObject({
    program_id: programId.describe(
      'The impact.com program or media partner id that appears in tracked links ({{program_id}}).',
    ),
    campaign_id: z
      .string()
      .min(1)
      .optional()
      .describe('Optional campaign id for templates that carry {{campaign_id}}.'),
  })
  .meta({
    title: 'ImpactConfig',
    description: 'The app owner’s impact.com identifiers. Never a credential.',
  });
export type ImpactConfig = z.infer<typeof ImpactConfig>;

/** Amazon Associates storefronts, as the domain suffix after `amazon.`. Tags are per storefront. */
export const AMAZON_MARKETPLACES = [
  'com',
  'ca',
  'com.mx',
  'com.br',
  'co.uk',
  'de',
  'fr',
  'es',
  'it',
  'nl',
  'se',
  'pl',
  'com.be',
  'com.tr',
  'ae',
  'sa',
  'eg',
  'in',
  'sg',
  'co.jp',
  'com.au',
] as const;

export const AmazonMarketplace = z.enum(AMAZON_MARKETPLACES).meta({
  title: 'AmazonMarketplace',
  description: 'An Amazon storefront as the domain suffix after amazon., e.g. com or co.uk.',
});
export type AmazonMarketplace = z.infer<typeof AmazonMarketplace>;

export const AmazonConfig = z
  .strictObject({
    tag: z
      .string()
      .min(1)
      .describe('The Associates tracking id (Associate tag), e.g. mysite-20, set as tag=.'),
    marketplace: AmazonMarketplace.optional().describe(
      'When set, templates must point at this storefront (tags are storefront-specific).',
    ),
  })
  .meta({
    title: 'AmazonConfig',
    description: 'The app owner’s Amazon Associates identifiers. Never a credential.',
  });
export type AmazonConfig = z.infer<typeof AmazonConfig>;

export const AffiliateConfig = z
  .strictObject({
    partnerstack: PartnerStackConfig.optional(),
    impact: ImpactConfig.optional(),
    amazon: AmazonConfig.optional(),
  })
  .meta({
    title: 'AffiliateConfig',
    description:
      'Per-app affiliate identifiers, one optional entry per AffiliateNetwork. The app owner brings their own accounts; a network without an entry yields no affiliate candidates.',
  });
export type AffiliateConfig = z.infer<typeof AffiliateConfig>;
