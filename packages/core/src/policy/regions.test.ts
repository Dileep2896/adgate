import type { PolicyRule } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { EU_MEMBER_STATES, isEuMemberState } from './eu-members.js';
import { evaluatePolicy, type PolicyEvaluation } from './evaluate.js';
import { FREE_US_USER, defaultPolicy, serveInput } from './evaluate.fixture.js';
import { EU_REGION_TOKEN, expandRegions, isRegionAllowed } from './regions.js';

const decision = (result: PolicyEvaluation, rule: PolicyRule) =>
  result.decisions.find((entry) => entry.rule === rule);

describe('EU_MEMBER_STATES', () => {
  it('lists the 27 member states as unique ISO 3166-1 alpha-2 codes', () => {
    expect(EU_MEMBER_STATES).toHaveLength(27);
    expect(new Set(EU_MEMBER_STATES).size).toBe(27);
    for (const code of EU_MEMBER_STATES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
    expect([...EU_MEMBER_STATES]).toEqual([...EU_MEMBER_STATES].sort());
  });

  it('uses ISO codes (GR, not the Eurostat EL) and excludes non-members', () => {
    expect(EU_MEMBER_STATES).toContain('DE');
    expect(EU_MEMBER_STATES).toContain('FR');
    expect(EU_MEMBER_STATES).toContain('IE');
    expect(EU_MEMBER_STATES).toContain('GR');
    expect(EU_MEMBER_STATES).not.toContain('EL');
    for (const nonMember of ['GB', 'CH', 'NO', 'IS', 'US', 'TR', 'UA', 'EU']) {
      expect(EU_MEMBER_STATES).not.toContain(nonMember);
    }
  });

  it('isEuMemberState narrows a region string', () => {
    expect(isEuMemberState('DE')).toBe(true);
    expect(isEuMemberState('GB')).toBe(false);
    expect(isEuMemberState('EU')).toBe(false);
    expect(isEuMemberState('de')).toBe(false);
  });
});

describe('expandRegions', () => {
  it('replaces the EU token with the member states and keeps other codes', () => {
    const expanded = expandRegions(['US', EU_REGION_TOKEN]);
    expect(expanded.has('US')).toBe(true);
    expect(expanded.has('DE')).toBe(true);
    expect(expanded.has('EU')).toBe(false);
    expect(expanded.size).toBe(1 + EU_MEMBER_STATES.length);
  });

  it('returns an empty set for an empty allow list', () => {
    expect(expandRegions([]).size).toBe(0);
  });

  it('does not duplicate a member state listed next to the EU token', () => {
    expect(expandRegions(['DE', 'EU']).size).toBe(EU_MEMBER_STATES.length);
  });
});

describe('isRegionAllowed', () => {
  it('allows a listed country and a member state through the EU token', () => {
    expect(isRegionAllowed('US', ['US', 'CA', 'GB', 'EU'])).toBe(true);
    expect(isRegionAllowed('DE', ['US', 'CA', 'GB', 'EU'])).toBe(true);
    expect(isRegionAllowed('DE', ['DE'])).toBe(true);
  });

  it('blocks unlisted countries, non-members under the EU token and the EU token as a region', () => {
    expect(isRegionAllowed('BR', ['US', 'CA', 'GB', 'EU'])).toBe(false);
    expect(isRegionAllowed('CH', ['EU'])).toBe(false);
    expect(isRegionAllowed('FR', ['DE'])).toBe(false);
    expect(isRegionAllowed('EU', ['EU'])).toBe(false);
    expect(isRegionAllowed('US', [])).toBe(false);
  });

  it('is case sensitive: codes are upper case by schema', () => {
    expect(isRegionAllowed('us', ['US'])).toBe(false);
  });
});

describe('evaluatePolicy regions', () => {
  it('allows a member state through the EU token of the default policy', () => {
    const result = evaluatePolicy(serveInput({ user: { ...FREE_US_USER, region: 'DE' } }));
    expect(result.allowed).toBe(true);
    expect(decision(result, 'regions')).toEqual({ rule: 'regions', result: 'pass' });
  });

  it('blocks a country outside regions.allow', () => {
    const result = evaluatePolicy(serveInput({ user: { ...FREE_US_USER, region: 'BR' } }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('region_blocked');
    expect(decision(result, 'regions')).toEqual({
      rule: 'regions',
      result: 'fail',
      detail: 'region=BR not in regions.allow',
    });
  });

  it('fails closed when the region is missing', () => {
    const result = evaluatePolicy(serveInput({ user: { tier: 'free' } }));
    expect(result.reason).toBe('region_blocked');
    expect(decision(result, 'regions')).toEqual({
      rule: 'regions',
      result: 'fail',
      detail: 'region missing',
    });
  });

  it('blocks a user region of EU: the token only has meaning inside the policy', () => {
    const result = evaluatePolicy(serveInput({ user: { ...FREE_US_USER, region: 'EU' } }));
    expect(result.reason).toBe('region_blocked');
  });

  it('honours a narrowed allow list without the EU token', () => {
    const policy = defaultPolicy({ regions: { allow: ['DE'] } });
    const inRegion = (region: string) =>
      evaluatePolicy(serveInput({ policy, user: { ...FREE_US_USER, region } }));
    expect(inRegion('DE').allowed).toBe(true);
    expect(inRegion('FR').reason).toBe('region_blocked');
    expect(inRegion('US').reason).toBe('region_blocked');
  });

  it('blocks everyone when regions.allow is empty', () => {
    const policy = defaultPolicy({ regions: { allow: [] } });
    expect(evaluatePolicy(serveInput({ policy })).reason).toBe('region_blocked');
  });
});
