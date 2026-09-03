import { describe, expect, it } from 'vitest';

import { DemandResponseSummary, DemandTrace, ExcludedCandidate } from './demand-trace.js';

/**
 * The `demand` block of the docs/audit.md example, copied verbatim. Keep it in sync by hand when
 * the contract doc changes (a human decision, see CLAUDE.md).
 */
export const AUDIT_DEMAND_EXAMPLE = {
  requested: ['direct', 'affiliate'],
  responses: [
    { source: 'direct', candidates: 2, latency_ms: 38 },
    { source: 'affiliate', candidates: 0, latency_ms: 61 },
  ],
  excluded: [],
  selected: 'direct',
};

const excluded = {
  source: 'direct',
  creative_id: 'cr_01J',
  advertiser_domain: 'competitor.com',
  reason: 'competitor_exclusion',
};

describe('DemandTrace', () => {
  it('parses the docs/audit.md demand block verbatim', () => {
    expect(DemandTrace.parse(AUDIT_DEMAND_EXAMPLE)).toEqual(AUDIT_DEMAND_EXAMPLE);
  });

  it('accepts a no-fill trace with a failed source, an exclusion and selected null', () => {
    const trace = {
      requested: ['direct', 'affiliate', 'koah'],
      responses: [
        { source: 'direct', candidates: 1, latency_ms: 3 },
        { source: 'affiliate', candidates: 0, latency_ms: 4, error: 'affiliate_not_configured' },
        { source: 'koah', candidates: 0, latency_ms: 250, error: 'timeout' },
      ],
      excluded: [excluded],
      selected: null,
    };
    expect(DemandTrace.parse(trace)).toEqual(trace);
  });

  it('accepts an empty trace (no adapters enabled)', () => {
    const empty = { requested: [], responses: [], excluded: [], selected: null };
    expect(DemandTrace.parse(empty)).toEqual(empty);
  });

  it('requires selected to be a known source or null, never absent', () => {
    const { selected, ...missing } = AUDIT_DEMAND_EXAMPLE;
    expect(selected).toBe('direct');
    expect(DemandTrace.safeParse(missing).success).toBe(false);
    expect(DemandTrace.safeParse({ ...AUDIT_DEMAND_EXAMPLE, selected: 'adsense' }).success).toBe(
      false,
    );
    expect(DemandTrace.safeParse({ ...AUDIT_DEMAND_EXAMPLE, requested: ['adsense'] }).success).toBe(
      false,
    );
  });
});

describe('DemandResponseSummary', () => {
  const ok = { source: 'direct', candidates: 2, latency_ms: 38 };

  it('carries the source, a candidate count, an integer latency and an optional error', () => {
    expect(DemandResponseSummary.parse(ok)).toEqual(ok);
    const failed = { ...ok, candidates: 0, error: 'timeout' };
    expect(DemandResponseSummary.parse(failed)).toEqual(failed);
  });

  it('rejects negative or fractional counts and latencies and an empty error', () => {
    expect(DemandResponseSummary.safeParse({ ...ok, candidates: -1 }).success).toBe(false);
    expect(DemandResponseSummary.safeParse({ ...ok, candidates: 1.5 }).success).toBe(false);
    expect(DemandResponseSummary.safeParse({ ...ok, latency_ms: -1 }).success).toBe(false);
    expect(DemandResponseSummary.safeParse({ ...ok, latency_ms: 0.5 }).success).toBe(false);
    expect(DemandResponseSummary.safeParse({ ...ok, error: '' }).success).toBe(false);
    expect(DemandResponseSummary.safeParse({ ...ok, candidates: [] }).success).toBe(false);
  });
});

describe('ExcludedCandidate', () => {
  it('names the source, creative, advertiser domain and the reason competitor_exclusion', () => {
    expect(ExcludedCandidate.parse(excluded)).toEqual(excluded);
  });

  it('rejects other reasons, a non-creative id and an empty domain', () => {
    expect(ExcludedCandidate.safeParse({ ...excluded, reason: 'other' }).success).toBe(false);
    expect(ExcludedCandidate.safeParse({ ...excluded, creative_id: 'adv_01' }).success).toBe(false);
    expect(ExcludedCandidate.safeParse({ ...excluded, advertiser_domain: '' }).success).toBe(false);
    const { reason, ...noReason } = excluded;
    expect(reason).toBe('competitor_exclusion');
    expect(ExcludedCandidate.safeParse(noReason).success).toBe(false);
  });
});
