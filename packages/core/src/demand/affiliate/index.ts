/**
 * Affiliate demand (docs/BUILD_GUIDE.md Phase 3 item 2). Template-based link builders for
 * PartnerStack, impact.com and Amazon Associates plus the adapter over a catalog. The app owner
 * brings their own affiliate accounts (docs/decisions.md item 6): adgate fills the owner's public
 * ids into templates and never holds credentials, API keys or payout details.
 */
export {
  AFFILIATE_MAX_CANDIDATES,
  AffiliateAdapter,
  createAffiliateAdapter,
  defaultDestination,
  selectAffiliateCandidates,
} from './adapter.js';
export type { AffiliateSelection } from './adapter.js';
export { buildAmazonUrl, isAmazonHost, setTagParam } from './amazon.js';
export { buildImpactUrl } from './impact.js';
export { buildPartnerStackUrl } from './partnerstack.js';
export {
  AFFILIATE_BUILDERS,
  AFFILIATE_NOT_CONFIGURED,
  buildAffiliateUrl,
  isAffiliateConfigured,
} from './registry.js';
export type { BuildAffiliateUrlInput } from './registry.js';
export { TEMPLATE_PLACEHOLDERS, fillTemplate, isHttpUrl } from './template.js';
export type { TemplatePlaceholder, TemplateValues } from './template.js';
export type {
  AffiliateAdapterOptions,
  AffiliateBuildInput,
  AffiliateBuildResult,
  AffiliateUrlBuilder,
} from './types.js';
