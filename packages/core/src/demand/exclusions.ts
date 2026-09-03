/**
 * Competitor exclusions (docs/policy.md rule 7): advertiser domains that must never be shown,
 * from policy.competitor_exclusions and DemandRequest.exclusions. Matching is case-insensitive
 * and covers subdomains (shop.competitor.com is excluded by competitor.com) but never
 * look-alikes (notcompetitor.com, competitor.com.example) or parents. Applied by mediate(),
 * never by the adapters, so the audit trace can list exactly what was dropped.
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//;
const PATH_START = /[/?#]/;
const PORT = /:\d*$/;
const LEADING_WILDCARDS = /^(?:\*?\.)+/;
const TRAILING_DOTS = /\.+$/;

/**
 * The bare registrable host a policy author or a catalog may have spelled in several ways:
 * trimmed and lower-cased, without a scheme (https://), userinfo (user:pw@), port, path, query
 * or fragment, without a leading `*.` or `.` wildcard, and without trailing dots (the FQDN
 * spelling). `*.competitor.com`, `.competitor.com` and `https://competitor.com/` all normalize
 * to `competitor.com`.
 */
export const normalizeDomain = (domain: string): string => {
  let host = domain.trim().toLowerCase().replace(SCHEME, '');
  host = host.split(PATH_START, 1)[0] ?? '';
  const userinfo = host.lastIndexOf('@');
  if (userinfo !== -1) {
    host = host.slice(userinfo + 1);
  }
  return host.replace(PORT, '').replace(LEADING_WILDCARDS, '').replace(TRAILING_DOTS, '');
};

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
