/**
 * Competitor exclusions (docs/policy.md rule 7): advertiser domains that must never be shown,
 * from policy.competitor_exclusions and DemandRequest.exclusions. Matching is case-insensitive
 * and covers subdomains (shop.competitor.com is excluded by competitor.com) but never
 * look-alikes (notcompetitor.com, competitor.com.example) or parents. Applied by mediate(),
 * never by the adapters, so the audit trace can list exactly what was dropped.
 */

/** Trimmed, lower-cased, without a trailing dot (the FQDN spelling). */
export const normalizeDomain = (domain: string): string =>
  domain.trim().toLowerCase().replace(/\.+$/, '');

/** True when `domain` is `exclusion` or a subdomain of it. A blank side never matches. */
export const domainMatches = (domain: string, exclusion: string): boolean => {
  const candidate = normalizeDomain(domain);
  const excluded = normalizeDomain(exclusion);
  if (candidate === '' || excluded === '') {
    return false;
  }
  return candidate === excluded || candidate.endsWith(`.${excluded}`);
};

export const isExcludedDomain = (domain: string, exclusions: readonly string[]): boolean =>
  exclusions.some((exclusion) => domainMatches(domain, exclusion));
