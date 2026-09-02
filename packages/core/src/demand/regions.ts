import { isRegionAllowed } from '../policy/regions.js';

/**
 * Whether a creative's target_regions admit the user's region. Same semantics as
 * policy.regions.allow (the EU token expands to the 27 member states, a user region of EU
 * never matches) with one addition: an empty target list means the creative runs everywhere.
 * A request without a region can only receive such untargeted creatives (fail closed).
 */
export const creativeServesRegion = (
  targetRegions: readonly string[],
  region: string | undefined,
): boolean => {
  if (targetRegions.length === 0) {
    return true;
  }
  if (region === undefined) {
    return false;
  }
  return isRegionAllowed(region, targetRegions);
};
