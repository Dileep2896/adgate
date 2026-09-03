import { describe, expect, it } from 'vitest';

import { utcDay } from './caps.js';

/** capStateFrom and nextCapRow are core's (packages/core/src/policy/caps.test.ts). */
describe('utcDay', () => {
  it('is the UTC calendar day, whatever the local zone', () => {
    expect(utcDay(Date.UTC(2026, 8, 2, 23, 59, 59))).toBe('2026-09-02');
    expect(utcDay(Date.UTC(2026, 8, 3, 0, 0, 0))).toBe('2026-09-03');
  });
});
