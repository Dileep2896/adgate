/**
 * The creative editor's client-safe vocabulary: which fields exist, what a problem with one
 * looks like, and the option lists the form renders.
 *
 * Like lib/policy-issue.ts this module has NO IMPORTS on purpose. components/creative-form.tsx
 * is a client component, so everything it reaches ends up in the browser bundle;
 * lib/creative-form.ts (the validation) imports @adgateio/schemas and @adgateio/core, which is
 * hundreds of kilobytes the browser has no use for - validation happens in a server action.
 *
 * The two option lists below are duplicated from @adgateio/schemas (DemandSource and
 * AffiliateNetwork) for that reason, and lib/creative-form.test.ts pins them to the enums, so
 * adding a network to the contract fails a test here instead of silently missing a dropdown.
 */

export type CreativeField =
  | 'advertiser_id'
  | 'advertiser'
  | 'advertiser_domain'
  | 'headline'
  | 'body'
  | 'cta'
  | 'url_template'
  | 'target_categories'
  | 'target_regions'
  | 'keywords'
  | 'ecpm'
  | 'source'
  | 'network'
  | 'program_id'
  | 'app_id'
  /** Not a field: something about the write as a whole (the row is gone, the database said no). */
  | 'form';

export interface CreativeFieldIssue {
  field: CreativeField;
  message: string;
}

export const issuesForField = (
  issues: readonly CreativeFieldIssue[],
  field: CreativeField,
): CreativeFieldIssue[] => issues.filter((issue) => issue.field === field);

/** The sources a catalog creative may have. koah and gravity are network stubs, not catalog rows. */
export const CREATIVE_SOURCE_VALUES = ['direct', 'affiliate'] as const;
export type CreativeSourceValue = (typeof CREATIVE_SOURCE_VALUES)[number];

export const AFFILIATE_NETWORK_VALUES = ['partnerstack', 'impact', 'amazon'] as const;

/** The advertiser select's "not one of these" option; any other value is an advertiser id. */
export const NEW_ADVERTISER_VALUE = '__new__';
/** The app select's "every app may serve this" option: creatives.app_id stays null. */
export const GLOBAL_CATALOG_VALUE = '';

export interface AdvertiserOption {
  id: string;
  name: string;
  domain: string;
}

export interface AppOption {
  id: string;
  name: string;
}

/** One creative as the form renders it: strings, exactly what the inputs hold. */
export interface CreativeFormValues {
  id: string;
  advertiserId: string;
  advertiserName: string;
  advertiserDomain: string;
  headline: string;
  body: string;
  cta: string;
  urlTemplate: string;
  /** Comma or newline separated; the parser splits on both. */
  targetCategories: string;
  targetRegions: string;
  keywords: string;
  ecpm: string;
  source: string;
  network: string;
  programId: string;
  active: boolean;
  appId: string;
}

export const EMPTY_CREATIVE_VALUES: CreativeFormValues = {
  id: '',
  advertiserId: NEW_ADVERTISER_VALUE,
  advertiserName: '',
  advertiserDomain: '',
  headline: '',
  body: '',
  cta: '',
  urlTemplate: '',
  targetCategories: '',
  targetRegions: '',
  keywords: '',
  ecpm: '0',
  source: 'direct',
  network: '',
  programId: '',
  active: true,
  appId: GLOBAL_CATALOG_VALUE,
};

/**
 * Why the form warns before you edit the copy of a creative that has already served. It is
 * shown, not hidden: an operator has to know that fixing a typo is also a change of record.
 */
export const CONTENT_HASH_WARNING =
  'Changing the advertiser, headline, body, CTA or URL rewrites this creative’s content_hash. Audit records written earlier reference the OLD hash, so verifying them will report a creative_hash mismatch. That is intended: the hash is what proves what was shown. Deactivate and create a new creative instead when the old records must keep verifying.';
