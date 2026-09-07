import { DELIVERABILITY_REASONS } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { blockedForApps, FIX_HERE, fixLocationSentence } from './delivery-copy';

describe('FIX_HERE', () => {
  it('has an entry for every reason the contract defines, and no others', () => {
    expect(Object.keys(FIX_HERE).sort()).toEqual([...DELIVERABILITY_REASONS].sort());
  });

  it('names only sections that exist on /apps/[id]', () => {
    const sections = new Set(Object.values(FIX_HERE).filter((value) => value !== null));
    expect(sections).toEqual(new Set(['Policy', 'Affiliate accounts']));
  });
});

describe('fixLocationSentence', () => {
  it('points at the section of the app page that fixes it', () => {
    expect(fixLocationSentence('affiliate_not_configured')).toBe(
      'Fix it under Affiliate accounts below.',
    );
    expect(fixLocationSentence('network_not_enabled')).toBe('Fix it under Policy below.');
  });

  it('says nothing for a reason that belongs to the creative, not the app', () => {
    expect(fixLocationSentence('inactive')).toBeNull();
    expect(fixLocationSentence('no_target_categories')).toBeNull();
  });

  it('says nothing when there is no reason at all', () => {
    expect(fixLocationSentence(null)).toBeNull();
  });
});

describe('blockedForApps', () => {
  it('counts only when there is more than one app to count', () => {
    expect(blockedForApps(2, 3)).toBe('blocked for 2 of 3 apps');
    expect(blockedForApps(3, 3)).toBe('blocked for 3 of 3 apps');
  });

  it('is silent for a creative only one app could ever serve', () => {
    expect(blockedForApps(1, 1)).toBeNull();
    expect(blockedForApps(0, 0)).toBeNull();
  });
});
