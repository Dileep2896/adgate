import { DemandTrace } from '@adgateio/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPolicy } from '../policy/evaluate.fixture.js';
import { request } from './direct.fixture.js';
import { FakeAdapter, NO_EXCLUSIONS, candidate, respond } from './mediate.fixture.js';
import { type MediationResult, mediate } from './mediate.js';
import { compareByRevenue, mediationScore } from './select.js';

/**
 * Selection, exclusions, ranking and the trace shape. Timing, timeouts, failures and
 * cancellation live in mediate-timing.test.ts. Fake timers everywhere so latencies are exact
 * and so afterEach can prove no timer outlives a call.
 */

/** The `demand` block of the docs/audit.md example, copied verbatim. */
const AUDIT_DEMAND_EXAMPLE = {
  requested: ['direct', 'affiliate'],
  responses: [
    { source: 'direct', candidates: 2, latency_ms: 38 },
    { source: 'affiliate', candidates: 0, latency_ms: 61 },
  ],
  excluded: [],
  selected: 'direct',
};

const settle = async (pending: Promise<MediationResult>): Promise<MediationResult> => {
  await vi.runAllTimersAsync();
  return pending;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe('mediate: trace', () => {
  it('reproduces the docs/audit.md demand block and validates against DemandTrace', async () => {
    const direct = respond(
      'direct',
      [candidate('cr_01', { ecpm: 12 }), candidate('cr_02', { ecpm: 8 })],
      { delayMs: 38 },
    );
    const affiliate = respond('affiliate', [], { delayMs: 61 });
    const req = request();

    const result = await settle(mediate([direct, affiliate], req, defaultPolicy()));

    expect(result.trace).toEqual(AUDIT_DEMAND_EXAMPLE);
    expect(DemandTrace.parse(result.trace)).toEqual(result.trace);
    expect(result.selected?.id).toBe('cr_01');
    expect(result.selected_source).toBe('direct');
    for (const adapter of [direct, affiliate]) {
      expect(adapter.calls).toBe(1);
      expect(adapter.lastOptions?.timeoutMs).toBe(250);
      expect(adapter.lastOptions?.signal).toBeInstanceOf(AbortSignal);
      expect(adapter.lastOptions?.signal?.aborted).toBe(false);
    }
    expect(direct.lastOptions?.signal).not.toBe(affiliate.lastOptions?.signal);
  });

  it('keeps requested and responses in adapter order whatever order the sources settle in', async () => {
    const adapters = [
      respond('affiliate', [], { delayMs: 50 }),
      respond('direct', [candidate('cr_01')], { delayMs: 5 }),
      respond('koah', []),
    ];
    const { trace } = await settle(mediate(adapters, request(), NO_EXCLUSIONS));
    expect(trace.requested).toEqual(['affiliate', 'direct', 'koah']);
    expect(trace.responses).toEqual([
      { source: 'affiliate', candidates: 0, latency_ms: 50 },
      { source: 'direct', candidates: 1, latency_ms: 5 },
      { source: 'koah', candidates: 0, latency_ms: 0 },
    ]);
    expect(trace.selected).toBe('direct');
  });

  it('lists a source twice when two adapters share it (one affiliate adapter per network)', async () => {
    const adapters = [
      respond('affiliate', [candidate('cr_ps', { source: 'affiliate' })]),
      respond('affiliate', [], { error: 'affiliate_not_configured' }),
    ];
    const { trace } = await settle(mediate(adapters, request(), NO_EXCLUSIONS));
    expect(trace.requested).toEqual(['affiliate', 'affiliate']);
    expect(trace.responses[1]).toEqual({
      source: 'affiliate',
      candidates: 0,
      latency_ms: 0,
      error: 'affiliate_not_configured',
    });
    expect(trace.selected).toBe('affiliate');
  });

  it('an empty adapters list yields an empty trace and no fill', async () => {
    const result = await settle(mediate([], request(), NO_EXCLUSIONS));
    expect(result).toEqual({
      selected: null,
      selected_source: null,
      trace: { requested: [], responses: [], excluded: [], selected: null },
    });
  });

  it('no candidates from any source is no fill: selected null everywhere', async () => {
    const adapters = [respond('direct', []), respond('affiliate', [])];
    const result = await settle(mediate(adapters, request(), NO_EXCLUSIONS));
    expect(result.selected).toBeNull();
    expect(result.selected_source).toBeNull();
    expect(result.trace.selected).toBeNull();
    expect(result.trace.responses.map((r) => r.candidates)).toEqual([0, 0]);
  });
});

describe('mediate: competitor exclusions', () => {
  it('drops excluded advertisers before ranking and lists them in trace.excluded', async () => {
    const adapters = [
      respond('direct', [
        candidate('cr_top', { ecpm: 100, match: 1, domain: 'competitor.com' }),
        candidate('cr_ok', { ecpm: 5, match: 0.75 }),
      ]),
    ];
    const policy = defaultPolicy({ competitor_exclusions: ['competitor.com'] });
    const result = await settle(mediate(adapters, request(), policy));

    expect(result.selected?.id).toBe('cr_ok');
    expect(result.trace.excluded).toEqual([
      {
        source: 'direct',
        creative_id: 'cr_top',
        advertiser_domain: 'competitor.com',
        reason: 'competitor_exclusion',
      },
    ]);
    // The count is what the adapter answered; exclusions are visible in `excluded`.
    expect(result.trace.responses).toEqual([{ source: 'direct', candidates: 2, latency_ms: 0 }]);
    expect(DemandTrace.parse(result.trace)).toEqual(result.trace);
  });

  it('matches case-insensitively and on subdomains, never on look-alike domains', async () => {
    const adapters = [
      respond('direct', [
        candidate('cr_1', { ecpm: 90, match: 1, domain: 'shop.competitor.com' }),
        candidate('cr_2', { ecpm: 80, match: 1, domain: 'COMPETITOR.COM' }),
        candidate('cr_3', { ecpm: 70, match: 1, domain: 'notcompetitor.com' }),
        candidate('cr_4', { ecpm: 60, match: 1, domain: 'competitor.com.example' }),
      ]),
    ];
    const policy = { competitor_exclusions: ['Competitor.com'] };
    const result = await settle(mediate(adapters, request(), policy));
    expect(result.selected?.id).toBe('cr_3');
    expect(result.trace.excluded.map((e) => [e.creative_id, e.advertiser_domain])).toEqual([
      ['cr_1', 'shop.competitor.com'],
      ['cr_2', 'COMPETITOR.COM'],
    ]);
  });

  it('honours req.exclusions as well as policy.competitor_exclusions', async () => {
    const adapters = () => [
      respond('direct', [
        candidate('cr_a', { ecpm: 50, domain: 'rival.io' }),
        candidate('cr_b', { ecpm: 40, domain: 'competitor.com' }),
        candidate('cr_c', { ecpm: 30, domain: 'fine.example' }),
      ]),
    ];
    const fromRequest = await settle(
      mediate(adapters(), request({ exclusions: ['rival.io'] }), NO_EXCLUSIONS),
    );
    expect(fromRequest.selected?.id).toBe('cr_b');
    expect(fromRequest.trace.excluded.map((e) => e.creative_id)).toEqual(['cr_a']);

    const fromBoth = await settle(
      mediate(adapters(), request({ exclusions: ['rival.io'] }), {
        competitor_exclusions: ['competitor.com'],
      }),
    );
    expect(fromBoth.selected?.id).toBe('cr_c');
    expect(fromBoth.trace.excluded.map((e) => e.creative_id)).toEqual(['cr_a', 'cr_b']);
  });

  it('is no fill when every candidate of every source is excluded', async () => {
    const adapters = [
      respond('direct', [candidate('cr_d', { domain: 'competitor.com' })]),
      respond('affiliate', [
        candidate('cr_f', { domain: 'eu.competitor.com', source: 'affiliate' }),
      ]),
    ];
    const result = await settle(
      mediate(adapters, request(), { competitor_exclusions: ['competitor.com'] }),
    );
    expect(result.selected).toBeNull();
    expect(result.selected_source).toBeNull();
    expect(result.trace.selected).toBeNull();
    expect(result.trace.excluded.map((e) => [e.source, e.creative_id])).toEqual([
      ['direct', 'cr_d'],
      ['affiliate', 'cr_f'],
    ]);
    expect(DemandTrace.parse(result.trace)).toEqual(result.trace);
  });
});

describe('mediate: ranking', () => {
  it('ranks across sources by ecpm_estimate * targeting_match, then ecpm_estimate', async () => {
    const adapters = [
      respond('direct', [
        candidate('cr_b', { ecpm: 4, match: 1 }), // 4
        candidate('cr_a', { ecpm: 10, match: 0.5 }), // 5, ecpm 10
      ]),
      respond('affiliate', [candidate('cr_c', { ecpm: 5, match: 1, source: 'affiliate' })]), // 5, ecpm 5
    ];
    const result = await settle(mediate(adapters, request(), NO_EXCLUSIONS));
    expect(result.selected?.id).toBe('cr_a');
    expect(result.selected_source).toBe('direct');
    expect(result.trace.selected).toBe('direct');
  });

  it('breaks a full tie on creative id ascending, whichever source answered first', async () => {
    const adapters = [
      respond('direct', [candidate('cr_z', { ecpm: 5, match: 1 })]),
      respond('affiliate', [candidate('cr_y', { ecpm: 5, match: 1, source: 'affiliate' })]),
    ];
    const result = await settle(mediate(adapters, request(), NO_EXCLUSIONS));
    expect(result.selected?.id).toBe('cr_y');
    expect(result.selected_source).toBe('affiliate');
  });

  it('exposes the score and the comparator', () => {
    expect(mediationScore(candidate('cr_1', { ecpm: 10, match: 0.5 }))).toBe(5);
    const ordered = [
      candidate('cr_b', { ecpm: 5, match: 1 }),
      candidate('cr_a', { ecpm: 5, match: 1 }),
      candidate('cr_c', { ecpm: 10, match: 0.5 }),
      candidate('cr_d', { ecpm: 2, match: 1 }),
      candidate('cr_e', { ecpm: 20, match: 0.5 }),
    ]
      .sort(compareByRevenue)
      .map((c) => c.id);
    expect(ordered).toEqual(['cr_e', 'cr_c', 'cr_a', 'cr_b', 'cr_d']);
  });

  it('an answer that carries candidates alongside an error still competes (S10 semantics)', async () => {
    const adapters = [
      respond('direct', [candidate('cr_d', { ecpm: 3 })]),
      new FakeAdapter('affiliate', {
        kind: 'respond',
        candidates: [candidate('cr_x', { ecpm: 50, match: 1, source: 'affiliate' })],
        error: 'build_failed:cr_y:invalid_url',
      }),
    ];
    const result = await settle(mediate(adapters, request(), NO_EXCLUSIONS));
    expect(result.selected?.id).toBe('cr_x');
    expect(result.trace.responses[1]).toEqual({
      source: 'affiliate',
      candidates: 1,
      latency_ms: 0,
      error: 'build_failed:cr_y:invalid_url',
    });
    expect(result.trace.selected).toBe('affiliate');
  });

  it('returns the winning candidate as the adapter produced it', async () => {
    const winner = candidate('cr_w', { ecpm: 9, match: 1 });
    const result = await settle(mediate([respond('direct', [winner])], request(), NO_EXCLUSIONS));
    expect(result.selected).toEqual(winner);
  });
});
