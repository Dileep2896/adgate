import { describe, expect, it } from 'vitest';

import { EU_MEMBER_STATES } from '../policy/eu-members.js';
import { creativeServesRegion } from './regions.js';

describe('creativeServesRegion', () => {
  const targets = ['US', 'CA', 'GB', 'EU'];

  it('admits a listed country and every EU member state through the EU token', () => {
    expect(creativeServesRegion(targets, 'US')).toBe(true);
    expect(creativeServesRegion(targets, 'GB')).toBe(true);
    for (const member of EU_MEMBER_STATES) {
      expect(creativeServesRegion(targets, member), member).toBe(true);
    }
  });

  it('rejects countries outside the list, non-members under EU and the token as a region', () => {
    expect(creativeServesRegion(targets, 'BR')).toBe(false);
    expect(creativeServesRegion(['EU'], 'CH')).toBe(false);
    expect(creativeServesRegion(['EU'], 'GB')).toBe(false);
    expect(creativeServesRegion(targets, 'EU')).toBe(false);
    expect(creativeServesRegion(['DE'], 'FR')).toBe(false);
  });

  it('treats an empty target list as every region, including a missing one', () => {
    expect(creativeServesRegion([], 'BR')).toBe(true);
    expect(creativeServesRegion([], undefined)).toBe(true);
  });

  it('fails closed when the region is missing and the creative is targeted', () => {
    expect(creativeServesRegion(targets, undefined)).toBe(false);
    expect(creativeServesRegion(['EU'], undefined)).toBe(false);
  });
});
