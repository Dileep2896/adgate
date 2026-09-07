import { readFileSync } from 'node:fs';

import { type Classification, DemandResponse, SeedCreative } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { classifyByRules } from '../classify/rules/classify.js';
import { assignCreativeIds } from './catalog.js';
import { DIRECT_MAX_CANDIDATES, DirectAdapter, createDirectAdapter } from './direct.js';
import { creative, request, sequentialUlidOptions } from './direct.fixture.js';
import { keywordsFromRulesMatches } from './keywords.js';
import { DEFAULT_DEMAND_TIMEOUT_MS } from './types.js';

const root = new URL('../../../../', import.meta.url);
const seeds = SeedCreative.array().parse(
  JSON.parse(readFileSync(new URL('examples/creatives.seed.json', root), 'utf8')),
);
const fixture = JSON.parse(
  readFileSync(new URL('fixtures/classify-fixtures.json', root), 'utf8'),
) as { cases: { id: string; text: string; expect: { categories_any?: string[] } }[] };
const c001 = fixture.cases.find((entry) => entry.id === 'c001');
if (c001 === undefined) {
  throw new Error('fixture c001 missing');
}

const catalog = assignCreativeIds(seeds, sequentialUlidOptions());
/**
 * A frozen clock: start and end read the same millisecond, so latency_ms is exactly 0 by
 * construction. Any adapter here whose latency_ms is asserted MUST be built with it. With the
 * real Date.now the elapsed time rounds to 0 ms on a fast dev machine and to 1 ms on a loaded CI
 * runner, which makes an exact latency_ms assertion flake. The injected-clock test at the bottom
 * of this file is what pins the measurement itself.
 */
const frozen = { now: () => 1_000 };
const seedAdapter = createDirectAdapter(catalog, frozen);
const opts = { timeoutMs: DEFAULT_DEMAND_TIMEOUT_MS };
const rules = classifyByRules(c001.text);
const c001Keywords = keywordsFromRulesMatches(rules.matches);
/** c001 as the fixture describes it: categories_any plus the rules terms as keywords. */
const c001Classification: Classification = {
  commercial_intent: rules.commercial_intent,
  categories: (c001.expect.categories_any ?? []) as Classification['categories'],
  sensitive: [],
  confidence: rules.confidence,
  method: 'rules',
  prompt_version: rules.prompt_version,
};

describe('DirectAdapter with examples/creatives.seed.json', () => {
  it('ranks Example DB Cloud first and Example Deploy second (via the wildcard) for c001', async () => {
    const response = await seedAdapter.fetch(
      request({ classification: c001Classification, keywords: c001Keywords }),
      opts,
    );
    expect(DemandResponse.parse(response)).toEqual(response);
    expect(response.source).toBe('direct');
    expect(response.error).toBeUndefined();
    expect(response.candidates.map((c) => c.advertiser)).toEqual([
      'Example DB Cloud',
      'Example Deploy',
    ]);
    const [db, deploy] = response.candidates;
    expect(db?.targeting_match).toBe(0.85);
    expect(db?.ecpm_estimate).toBe(12);
    expect(db?.resolved_url).toBe('https://exampledb.dev/?ref=adgate');
    expect(deploy?.targeting_match).toBe(0.65);
    expect(deploy?.ecpm_estimate).toBe(9);
    expect(db?.id).toBe(catalog[0]?.id);
  });

  it('keeps Example DB Cloud first when the rules classification lists hosting too', async () => {
    const { matches, ...classification } = rules;
    expect(matches.commercial.map((match) => match.category)).toEqual([
      'software.devtools.database',
      'software.devtools.hosting',
    ]);
    expect(classification.categories).toEqual([
      'software.devtools.database',
      'software.devtools.hosting',
    ]);
    const response = await seedAdapter.fetch(
      request({ classification, keywords: c001Keywords }),
      opts,
    );
    expect(response.candidates.map((c) => c.advertiser)).toEqual([
      'Example DB Cloud',
      'Example Deploy',
    ]);
    expect(response.candidates[1]?.targeting_match).toBe(0.8);
  });

  it('never returns the affiliate seed creative, even for its own category', async () => {
    const response = await seedAdapter.fetch(
      request({
        classification: { ...c001Classification, categories: ['education.language'] },
        keywords: ['learn spanish'],
      }),
      opts,
    );
    expect(response.candidates).toEqual([]);
  });

  it('serves without keywords on category alone', async () => {
    const response = await seedAdapter.fetch(request({ classification: c001Classification }), opts);
    expect(response.candidates.map((c) => c.advertiser)).toEqual([
      'Example DB Cloud',
      'Example Deploy',
    ]);
    expect(response.candidates[0]?.targeting_match).toBe(0.75);
  });
});

describe('DirectAdapter region filtering', () => {
  const advertisers = async (region: string | undefined) => {
    const response = await seedAdapter.fetch(
      request({ classification: c001Classification, user: region ? { region } : {} }),
      opts,
    );
    return response.candidates.map((c) => c.advertiser);
  };

  it('serves US directly and DE through the EU token', async () => {
    expect(await advertisers('US')).toEqual(['Example DB Cloud', 'Example Deploy']);
    expect(await advertisers('DE')).toEqual(['Example DB Cloud', 'Example Deploy']);
  });

  it('serves nothing targeted to BR or to a missing region', async () => {
    expect(await advertisers('BR')).toEqual([]);
    expect(await advertisers(undefined)).toEqual([]);
  });

  it('serves untargeted creatives everywhere, including without a region', async () => {
    const adapter = createDirectAdapter([creative({ target_regions: [] })]);
    for (const user of [{ region: 'BR' }, {}]) {
      const response = await adapter.fetch(request({ user }), opts);
      expect(response.candidates).toHaveLength(1);
    }
  });
});

describe('DirectAdapter selection rules', () => {
  it('never returns inactive creatives', async () => {
    const adapter = createDirectAdapter([
      creative({ id: 'cr_01', active: false, ecpm: 100 }),
      creative({ id: 'cr_02', active: true }),
    ]);
    const response = await adapter.fetch(request(), opts);
    expect(response.candidates.map((c) => c.id)).toEqual(['cr_02']);
  });

  it('orders by ecpm * targeting_match, then ecpm, then id ascending on full ties', async () => {
    const adapter = createDirectAdapter([
      creative({ id: 'cr_03', ecpm: 5 }), // 0.75 * 5 = 3.75
      creative({ id: 'cr_01', ecpm: 5 }), // 3.75
      creative({ id: 'cr_02', ecpm: 5 }), // 3.75
      creative({ id: 'cr_04', ecpm: 9, target_categories: ['software.*'] }), // 0.6 * 9 = 5.4
      creative({ id: 'cr_00', ecpm: 7 }), // 5.25
    ]);
    const response = await adapter.fetch(request(), opts);
    expect(response.candidates.map((c) => c.id)).toEqual(['cr_04', 'cr_00', 'cr_01']);
    expect(response.candidates).toHaveLength(DIRECT_MAX_CANDIDATES);
    const wildcard = await createDirectAdapter([
      creative({ id: 'cr_04', ecpm: 9, target_categories: ['software.*'] }),
      creative({ id: 'cr_05', ecpm: 1 }),
    ]).fetch(request(), opts);
    expect(wildcard.candidates.map((c) => c.id)).toEqual(['cr_04', 'cr_05']);
  });

  it('cuts its top 3 with the revenue order mediation uses, never by targeting alone', async () => {
    // Four exact matches at ecpm 10 (score 7.5 each) and one wildcard match at ecpm 100
    // (score 60): the wildcard creative must survive the cut, or mediation could never pick it.
    const adapter = createDirectAdapter([
      creative({ id: 'cr_01', ecpm: 10 }),
      creative({ id: 'cr_02', ecpm: 10 }),
      creative({ id: 'cr_03', ecpm: 10 }),
      creative({ id: 'cr_04', ecpm: 10 }),
      creative({ id: 'cr_05', ecpm: 100, target_categories: ['software.devtools.*'] }),
    ]);
    const response = await adapter.fetch(request(), opts);
    expect(response.candidates.map((c) => [c.id, c.targeting_match, c.ecpm_estimate])).toEqual([
      ['cr_05', 0.6, 100],
      ['cr_01', 0.75, 10],
      ['cr_02', 0.75, 10],
    ]);
  });

  it('does not apply competitor exclusions (mediation does)', async () => {
    const adapter = createDirectAdapter([creative({ advertiser_domain: 'competitor.com' })]);
    const response = await adapter.fetch(request({ exclusions: ['competitor.com'] }), opts);
    expect(response.candidates).toHaveLength(1);
  });

  it('copies the catalog so later mutation does not leak in', async () => {
    const entries = [creative()];
    const adapter = createDirectAdapter(entries);
    entries.push(creative({ id: 'cr_99' }));
    const response = await adapter.fetch(request(), opts);
    expect(response.candidates).toHaveLength(1);
  });
});

describe('DirectAdapter never throws', () => {
  it('returns [] for an empty catalog and for a classification without categories', async () => {
    expect((await createDirectAdapter([]).fetch(request(), opts)).candidates).toEqual([]);
    const response = await seedAdapter.fetch(
      request({ classification: { ...c001Classification, categories: [] } }),
      opts,
    );
    expect(response).toEqual({ source: 'direct', candidates: [], latency_ms: 0 });
  });

  it('reports an aborted signal instead of candidates', async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await seedAdapter.fetch(request({ classification: c001Classification }), {
      timeoutMs: 250,
      signal: controller.signal,
    });
    expect(response).toEqual({ source: 'direct', candidates: [], latency_ms: 0, error: 'aborted' });
  });

  it('turns malformed input and a throwing clock into an error response', async () => {
    const broken = createDirectAdapter([creative()]);
    const malformed = request({ user: null as unknown as { region?: string } });
    const response = await broken.fetch(malformed, opts);
    expect(response.candidates).toEqual([]);
    expect(response.error).toBe('TypeError');
    let calls = 0;
    const clock = new DirectAdapter([creative()], {
      now: () => {
        calls += 1;
        throw new Error('no clock');
      },
    });
    const clocked = await clock.fetch(request(), opts);
    expect(clocked.candidates).toHaveLength(1);
    expect(clocked.latency_ms).toBe(0);
    expect(calls).toBe(2);
  });

  it('reports a throw by its error name only, never its message', async () => {
    const trap = creative({ id: 'cr_trap' });
    Object.defineProperty(trap, 'active', {
      get() {
        throw new Error('secret message');
      },
    });
    // Frozen clock (see `frozen` above): latency_ms is 0 by construction, not by measurement.
    const response = await createDirectAdapter([trap], frozen).fetch(request(), opts);
    expect(response).toEqual({ source: 'direct', candidates: [], latency_ms: 0, error: 'Error' });
    expect(JSON.stringify(response)).not.toContain('secret');
  });

  it('measures latency_ms with the injected clock', async () => {
    const ticks = [1000, 1038];
    const adapter = createDirectAdapter(catalog, { now: () => ticks.shift() ?? 0 });
    const response = await adapter.fetch(request({ classification: c001Classification }), opts);
    expect(response.latency_ms).toBe(38);
    expect(adapter.source).toBe('direct');
  });
});
