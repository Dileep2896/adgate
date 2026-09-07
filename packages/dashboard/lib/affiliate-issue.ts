/**
 * The affiliate form's field names, its option lists and the shape a refusal takes.
 *
 * DEPENDENCY FREE, like lib/creative-issue.ts and for the same reason: the form is a client
 * component, and importing the contract schema to get the marketplace list would pull zod and
 * @adgateio/schemas into the browser bundle. lib/affiliate-form.test.ts pins AMAZON_MARKETPLACE_VALUES
 * against the real enum, so the copy here cannot drift from the schema it mirrors.
 *
 * NOTHING HERE IS A SECRET. An affiliate config carries only the public identifiers that already
 * appear in a tracked link (docs/decisions.md item 6), which is why - unlike an API key - the
 * stored values are rendered back into the form every time the page loads.
 */

export const AFFILIATE_FIELDS = [
  'partnerstack_program_id',
  'impact_program_id',
  'impact_campaign_id',
  'amazon_tag',
  'amazon_marketplace',
  'form',
] as const;

export type AffiliateField = (typeof AFFILIATE_FIELDS)[number];

export interface AffiliateFieldIssue {
  field: AffiliateField;
  message: string;
}

/** The form's values as strings, which is what an uncontrolled input holds. */
export interface AffiliateFormValues {
  partnerstackProgramId: string;
  impactProgramId: string;
  impactCampaignId: string;
  amazonTag: string;
  amazonMarketplace: string;
}

export const EMPTY_AFFILIATE_VALUES: AffiliateFormValues = {
  partnerstackProgramId: '',
  impactProgramId: '',
  impactCampaignId: '',
  amazonTag: '',
  amazonMarketplace: '',
};

/**
 * Amazon storefronts, as the domain suffix after `amazon.`. A copy of AMAZON_MARKETPLACES from
 * @adgateio/schemas; the test asserts the two lists are identical.
 */
export const AMAZON_MARKETPLACE_VALUES: readonly string[] = [
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
];

/** The issues attached to one field, for rendering under it. */
export const affiliateIssuesForField = (
  issues: readonly AffiliateFieldIssue[],
  field: AffiliateField,
): AffiliateFieldIssue[] => issues.filter((issue) => issue.field === field);

/** What the form says when the database, not the operator, refused the write. */
export const AFFILIATE_WRITE_FAILED_MESSAGE =
  'The gateway database rejected that write. Nothing was changed. Check the dashboard logs.';
