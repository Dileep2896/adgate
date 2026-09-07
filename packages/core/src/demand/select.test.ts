import type { Candidate } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { creative, request } from './direct.fixture.js';
import {
  MAX_CANDIDATES,
  compareByRevenue,
  matchScore,
  mediationScore,
  rankCandidates,
} from './select.js';

describe('matchScore', () => {
  it('is 0 for inactive creatives, region misses and category misses', () => {
    expect(matchScore(creative({ active: false }), request(), [])).toBe(0);
    expect(
      matchScore(creative({ target_regions: ['GB'] }), request({ user: { region: 'US' } }), []),
    ).toBe(0);
    expect(matchScore(creative({ target_regions: ['EU'] }), request({ user: {} }), [])).toBe(0);
    expect(matchScore(creative({ target_categories: ['education.language'] }), request(), [])).toBe(
      0,
    );
  });

  it('is the targeting score otherwise, whatever the source', () => {
    expect(matchScore(creative(), request(), [])).toBe(0.75);
    expect(
      matchScore(creative({ source: 'affiliate', keywords: ['postgres', 'neon'] }), request(), [
        'postgres',
      ]),
    ).toBe(0.875);
    expect(
      matchScore(creative({ target_regions: ['EU'] }), request({ user: { region: 'DE' } }), []),
    ).toBe(0.75);
  });
});

describe('rankCandidates', () => {
  const candidate = (id: string, targeting_match: number, ecpm_estimate: number): Candidate => ({
    ...creative({ id }),
    ecpm_estimate,
    targeting_match,
  });

  it('orders by ecpm * targeting_match desc, ecpm desc, id asc and keeps the top MAX_CANDIDATES', () => {
    const ranked = rankCandidates([
      candidate('cr_03', 0.75, 5), // 3.75
      candidate('cr_01', 0.75, 5), // 3.75
      candidate('cr_04', 0.6, 9), // 5.4
      candidate('cr_00', 0.75, 7), // 5.25
      candidate('cr_02', 1, 1), // 1
    ]);
    expect(ranked.map((c) => c.id)).toEqual(['cr_04', 'cr_00', 'cr_01']);
    expect(MAX_CANDIDATES).toBe(3);
  });

  it('uses the revenue order mediation uses: match 0.8 at ecpm 100 beats match 1 at ecpm 10', () => {
    const rich = candidate('cr_rich', 0.8, 100);
    const exact = candidate('cr_exact', 1, 10);
    expect(rankCandidates([exact, rich]).map((c) => c.id)).toEqual(['cr_rich', 'cr_exact']);
    expect(compareByRevenue(rich, exact)).toBeLessThan(0);
    expect(mediationScore(rich)).toBe(80);
    expect(mediationScore(exact)).toBe(10);
    // An equal score falls to the higher ecpm, then to the id.
    expect(rankCandidates([candidate('cr_a', 0.5, 10), candidate('cr_b', 1, 5)])[0]?.id).toBe(
      'cr_a',
    );
  });

  it('does not mutate its input and honours a custom limit', () => {
    const second = candidate('cr_02', 0.6, 1);
    const first = candidate('cr_01', 0.6, 1);
    const input = [second, first];
    expect(rankCandidates(input, 1).map((c) => c.id)).toEqual(['cr_01']);
    expect(input.map((c) => c.id)).toEqual(['cr_02', 'cr_01']);
    expect(compareByRevenue(second, first)).toBeGreaterThan(0);
    expect(compareByRevenue(first, first)).toBe(0);
  });
});
