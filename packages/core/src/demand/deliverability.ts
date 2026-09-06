import type {
  AffiliateConfig,
  AffiliateNetwork,
  CatalogCreative,
  CreativeDeliverability,
  DeliverabilityReason,
  DemandSource,
  PolicyConfig,
} from '@adgate/schemas';

import { expandRegions, isRegionAllowed } from '../policy/regions.js';
import { isWildcardTarget, WILDCARD_SUFFIX } from './match.js';

/**
 * Why a creative that looks healthy in the catalog can never serve for one app. Everything it
 * reports is CORRECT gateway behaviour (an unlisted network is simply never queried; an app
 * with no affiliate_config has no affiliate accounts to credit), which is exactly why it needs
 * saying out loud: the only other evidence is one line inside the audit record's demand trace.
 *
 * Pure: no I/O, no env, no clock. It answers per (creative, app) and never looks at a turn, so
 * "deliverable" means "nothing structural blocks it", not "it will win the next auction". A
 * creative can be deliverable under one app's policy and blocked under another's.
 *
 * Checked in DELIVERABILITY_REASONS order, first failure wins:
 *   1. inactive                  active is false.
 *   2. source_not_enabled        no enabled policy.demand entry for the creative's source.
 *   3. network_not_enabled       affiliate creative whose network is on no enabled entry.
 *   4. affiliate_not_configured  the network is enabled but the app has no credentials for it.
 *   5. region_never_allowed      target_regions and policy.regions.allow never intersect.
 *   6. no_target_categories      the creative targets nothing, so it matches nothing.
 *   7. all_categories_blocked    every target category is in policy.blocked_categories.
 */

/** The creative fields the diagnostic reads. CatalogCreative and SeedCreative both satisfy it. */
export type DeliverabilityCreative = Pick<
  CatalogCreative,
  'active' | 'source' | 'network' | 'target_categories' | 'target_regions'
>;

export interface DeliverabilityContext {
  /** The app's effective policy (docs/policy.md). */
  policy: Pick<PolicyConfig, 'demand' | 'regions' | 'blocked_categories'>;
  /** apps.affiliate_config. Absent or {} = the app owner has no affiliate accounts at all. */
  affiliateConfig?: AffiliateConfig | undefined;
}

const DELIVERABLE: CreativeDeliverability = { deliverable: true };

const blocked = (reason: DeliverabilityReason, detail: string): CreativeDeliverability => ({
  deliverable: false,
  reason,
  detail,
});

/** A human list for the `detail` sentence. Never creative copy, only policy and catalog fields. */
const list = (values: readonly string[]): string =>
  values.length === 0 ? 'none' : values.join(', ');

/** Sources with at least one enabled demand entry, in policy order, without repeats. */
export const enabledDemandSources = (policy: Pick<PolicyConfig, 'demand'>): DemandSource[] => [
  ...new Set(policy.demand.filter((entry) => entry.enabled).map((entry) => entry.source)),
];

/** Networks named by an enabled affiliate demand entry, in policy order, without repeats. */
export const enabledAffiliateNetworks = (
  policy: Pick<PolicyConfig, 'demand'>,
): AffiliateNetwork[] => [
  ...new Set(
    policy.demand.flatMap((entry) =>
      entry.enabled && entry.source === 'affiliate' ? [entry.network] : [],
    ),
  ),
];

/**
 * The networks an affiliate creative could be served through. A creative WITHOUT a `network`
 * belongs to whichever network the policy names (see AffiliateAdapter), so every enabled
 * affiliate entry is a chance for it.
 */
const networksFor = (
  creative: DeliverabilityCreative,
  enabled: readonly AffiliateNetwork[],
): AffiliateNetwork[] => (creative.network === undefined ? [...enabled] : [creative.network]);

/**
 * The category a target names, ignoring a trailing wildcard: software.devtools.* is compared as
 * software.devtools. A blocked category also blocks everything under it, so blocking `gambling`
 * blocks a creative targeting `gambling.sports.*`.
 */
export const targetCategoryBase = (target: string): string =>
  isWildcardTarget(target) ? target.slice(0, -WILDCARD_SUFFIX.length) : target;

const isBlockedCategory = (target: string, blockedCategories: readonly string[]): boolean => {
  const base = targetCategoryBase(target);
  return blockedCategories.some((category) => base === category || base.startsWith(`${category}.`));
};

/** True when the creative's regions and the policy's regions.allow can ever admit one country. */
const servesSomeAllowedRegion = (
  creative: DeliverabilityCreative,
  policy: Pick<PolicyConfig, 'regions'>,
): boolean => {
  // An empty target list means "every region", so what is left is whatever the policy allows.
  if (creative.target_regions.length === 0) {
    return expandRegions(policy.regions.allow).size > 0;
  }
  return [...expandRegions(creative.target_regions)].some((region) =>
    isRegionAllowed(region, policy.regions.allow),
  );
};

const affiliateFailure = (
  creative: DeliverabilityCreative,
  context: DeliverabilityContext,
): CreativeDeliverability => {
  const enabled = enabledAffiliateNetworks(context.policy);
  const network = creative.network;
  if (network !== undefined && !enabled.includes(network)) {
    return blocked(
      'network_not_enabled',
      `the creative is on affiliate network ${network}, which the app's policy demand list does not enable (enabled affiliate networks: ${list(enabled)}); add an affiliate entry for ${network} to the app's policy demand list`,
    );
  }
  const config = context.affiliateConfig ?? {};
  const candidates = networksFor(creative, enabled);
  if (candidates.some((entry) => config[entry] !== undefined)) {
    return DELIVERABLE;
  }
  const keys = candidates.map((entry) => `affiliate_config.${entry}`).join(' or ');
  return blocked(
    'affiliate_not_configured',
    `affiliate network ${list(candidates)} is enabled but the app carries no credentials for it; set ${keys} on the app`,
  );
};

/**
 * Whether `creative` can serve for the app described by `context`, and if not, the first reason
 * in the documented order together with a sentence naming the change that unblocks it.
 */
export const creativeDeliverability = (
  creative: DeliverabilityCreative,
  context: DeliverabilityContext,
): CreativeDeliverability => {
  if (!creative.active) {
    return blocked('inactive', 'the creative is inactive; set active to true to serve it');
  }

  const sources = enabledDemandSources(context.policy);
  if (!sources.includes(creative.source)) {
    return blocked(
      'source_not_enabled',
      `the app's policy demand list has no enabled ${creative.source} entry (enabled sources: ${list(sources)}); enable ${creative.source} in the app's policy demand list`,
    );
  }

  if (creative.source === 'affiliate') {
    const affiliate = affiliateFailure(creative, context);
    if (!affiliate.deliverable) {
      return affiliate;
    }
  }

  if (!servesSomeAllowedRegion(creative, context.policy)) {
    if (creative.target_regions.length === 0) {
      return blocked(
        'region_never_allowed',
        "the app's policy regions.allow is empty, so no creative can serve anywhere; add a region to regions.allow",
      );
    }
    return blocked(
      'region_never_allowed',
      `the creative's target_regions (${list(creative.target_regions)}) never overlap the app's policy regions.allow (${list(context.policy.regions.allow)}); widen one of the two lists`,
    );
  }

  if (creative.target_categories.length === 0) {
    return blocked(
      'no_target_categories',
      'the creative has no target_categories, so no classification can ever match it; add at least one category',
    );
  }

  const blockedCategories = context.policy.blocked_categories;
  if (creative.target_categories.every((target) => isBlockedCategory(target, blockedCategories))) {
    return blocked(
      'all_categories_blocked',
      `every target category (${list(creative.target_categories)}) is blocked by the app's policy blocked_categories; retarget the creative or unblock the category`,
    );
  }

  return DELIVERABLE;
};
