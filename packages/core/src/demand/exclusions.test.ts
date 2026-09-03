import { describe, expect, it } from 'vitest';

import { domainMatches, isExcludedDomain, normalizeDomain } from './exclusions.js';

describe('normalizeDomain', () => {
  it('lowercases, trims and drops a trailing dot', () => {
    expect(normalizeDomain('  Shop.Competitor.COM. ')).toBe('shop.competitor.com');
    expect(normalizeDomain('competitor.com')).toBe('competitor.com');
    expect(normalizeDomain('')).toBe('');
    expect(normalizeDomain('...')).toBe('');
  });
});

describe('domainMatches', () => {
  it('matches the domain itself and any subdomain, case-insensitively', () => {
    expect(domainMatches('competitor.com', 'competitor.com')).toBe(true);
    expect(domainMatches('COMPETITOR.COM', 'competitor.com')).toBe(true);
    expect(domainMatches('shop.competitor.com', 'Competitor.com')).toBe(true);
    expect(domainMatches('a.b.competitor.com', 'competitor.com.')).toBe(true);
  });

  it('never matches look-alike domains, parents or a blank exclusion', () => {
    expect(domainMatches('notcompetitor.com', 'competitor.com')).toBe(false);
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
