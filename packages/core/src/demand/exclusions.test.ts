import { describe, expect, it } from 'vitest';

import { domainMatches, isExcludedDomain, normalizeDomain } from './exclusions.js';

describe('normalizeDomain', () => {
  it('lowercases, trims and drops a trailing dot', () => {
    expect(normalizeDomain('  Shop.Competitor.COM. ')).toBe('shop.competitor.com');
    expect(normalizeDomain('competitor.com')).toBe('competitor.com');
    expect(normalizeDomain('')).toBe('');
    expect(normalizeDomain('...')).toBe('');
  });

  it('strips a leading wildcard or dot', () => {
    expect(normalizeDomain('*.competitor.com')).toBe('competitor.com');
    expect(normalizeDomain('.competitor.com')).toBe('competitor.com');
    expect(normalizeDomain('*.*.competitor.com')).toBe('competitor.com');
    expect(normalizeDomain(' *.Competitor.COM. ')).toBe('competitor.com');
  });

  it('strips a scheme, userinfo, port, path, query and fragment', () => {
    expect(normalizeDomain('https://competitor.com/')).toBe('competitor.com');
    expect(normalizeDomain('HTTPS://Competitor.com')).toBe('competitor.com');
    expect(normalizeDomain('http://shop.competitor.com/path/to?x=1#frag')).toBe(
      'shop.competitor.com',
    );
    expect(normalizeDomain('https://user:p%40ss@competitor.com:8443/path?q#f')).toBe(
      'competitor.com',
    );
    expect(normalizeDomain('competitor.com:443')).toBe('competitor.com');
    expect(normalizeDomain('competitor.com?tag=1')).toBe('competitor.com');
    expect(normalizeDomain('competitor.com#top')).toBe('competitor.com');
    expect(normalizeDomain('https://*.competitor.com./')).toBe('competitor.com');
    expect(normalizeDomain('https://')).toBe('');
  });
});

describe('domainMatches', () => {
  it('matches the domain itself and any subdomain, case-insensitively', () => {
    expect(domainMatches('competitor.com', 'competitor.com')).toBe(true);
    expect(domainMatches('COMPETITOR.COM', 'competitor.com')).toBe(true);
    expect(domainMatches('shop.competitor.com', 'Competitor.com')).toBe(true);
    expect(domainMatches('a.b.competitor.com', 'competitor.com.')).toBe(true);
  });

  it.each(['*.competitor.com', '.competitor.com', 'https://competitor.com/'])(
    'the spelling %s excludes competitor.com and its subdomains, never notcompetitor.com',
    (exclusion) => {
      expect(domainMatches('competitor.com', exclusion)).toBe(true);
      expect(domainMatches('shop.competitor.com', exclusion)).toBe(true);
      expect(domainMatches('COMPETITOR.COM', exclusion)).toBe(true);
      expect(domainMatches('notcompetitor.com', exclusion)).toBe(false);
      expect(domainMatches('competitor.com.example', exclusion)).toBe(false);
      expect(isExcludedDomain('eu.shop.competitor.com', [exclusion])).toBe(true);
      expect(isExcludedDomain('notcompetitor.com', [exclusion])).toBe(false);
    },
  );

  it('normalizes the candidate side the same way', () => {
    expect(domainMatches('https://shop.competitor.com/landing', 'competitor.com')).toBe(true);
    expect(domainMatches('Competitor.com:443', '*.competitor.com')).toBe(true);
  });

  it('never matches look-alike domains, parents or a blank exclusion', () => {
    expect(domainMatches('notcompetitor.com', 'competitor.com')).toBe(false);
    expect(domainMatches('notcompetitor.com', '*.competitor.com')).toBe(false);
    expect(domainMatches('competitor.com', '*')).toBe(false);
    expect(domainMatches('competitor.com', 'https://')).toBe(false);
    expect(domainMatches('competitor.com.example', 'competitor.com')).toBe(false);
    expect(domainMatches('competitor.co', 'competitor.com')).toBe(false);
    expect(domainMatches('competitor.com', 'shop.competitor.com')).toBe(false);
    expect(domainMatches('competitor.com', '')).toBe(false);
    expect(domainMatches('competitor.com', '   ')).toBe(false);
    expect(domainMatches('', 'competitor.com')).toBe(false);
  });
});

describe('isExcludedDomain', () => {
  it('is true when any exclusion matches and false for an empty list', () => {
    expect(isExcludedDomain('shop.competitor.com', ['other.io', 'competitor.com'])).toBe(true);
    expect(isExcludedDomain('advertiser.test', ['other.io', 'competitor.com'])).toBe(false);
    expect(isExcludedDomain('advertiser.test', [])).toBe(false);
  });
});
