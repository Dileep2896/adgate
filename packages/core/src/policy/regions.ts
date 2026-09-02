import { EU_MEMBER_STATES } from './eu-members.js';

/** The one non-country token policy.regions.allow may contain (docs/policy.md). */
export const EU_REGION_TOKEN = 'EU';

/**
 * The country codes a regions.allow list admits: every listed code, with the EU token replaced
 * by the 27 member states. The token itself is not a country and is never part of the result.
 */
export const expandRegions = (allow: readonly string[]): Set<string> => {
  const expanded = new Set<string>();
  for (const entry of allow) {
    if (entry === EU_REGION_TOKEN) {
      for (const member of EU_MEMBER_STATES) {
        expanded.add(member);
      }
    } else {
      expanded.add(entry);
    }
  }
  return expanded;
};

/**
 * True when `region` (an ISO 3166-1 alpha-2 code from user.region) is admitted by `allow`.
 * A user region of EU never matches: the token only has meaning inside the policy.
 */
export const isRegionAllowed = (region: string, allow: readonly string[]): boolean =>
  expandRegions(allow).has(region);
