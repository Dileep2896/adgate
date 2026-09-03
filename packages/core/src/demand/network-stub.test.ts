import { readFileSync } from 'node:fs';

import { DemandResponse, DemandTrace, GravityConfig, KoahConfig } from '@adgate/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { creative, request } from './direct.fixture.js';
import { createDirectAdapter } from './direct.js';
import { GravityAdapter, createGravityAdapter } from './gravity.js';
import { KoahAdapter, createKoahAdapter } from './koah.js';
import { NO_EXCLUSIONS } from './mediate.fixture.js';
import { mediate } from './mediate.js';
import {
  NETWORK_NOT_CONFIGURED,
  NETWORK_NOT_IMPLEMENTED,
  NetworkStubAdapter,
  isNetworkConfigured,
} from './network-stub.js';
import { DEFAULT_DEMAND_TIMEOUT_MS } from './types.js';

/**
 * docs/decisions.md item 10: the partner stubs are complete DemandAdapters that never call a
 * network and never yield a candidate. The file header checks read koah.ts and gravity.ts from
 * disk here, in the test; the adapters themselves never touch fs (purity.test.ts).
 */
const opts = { timeoutMs: DEFAULT_DEMAND_TIMEOUT_MS };
const CREDENTIALS = { api_key: 'sk_test', base_url: 'https://api.partner.example' };
const frozen = { now: () => 0 };

const partners = [
  {
    source: 'koah',
    create: createKoahAdapter,
    Adapter: KoahAdapter,
    Config: KoahConfig,
    file: 'koah.ts',
  },
  {
    source: 'gravity',
    create: createGravityAdapter,
    Adapter: GravityAdapter,
    Config: GravityConfig,
    file: 'gravity.ts',
  },
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(partners)('$source adapter stub', ({ source, create, Adapter, Config, file }) => {
  const notConfigured = { source, candidates: [], latency_ms: 0, error: NETWORK_NOT_CONFIGURED };

  it('is a DemandAdapter for its source', () => {
    const adapter = create({ enabled: false });
    expect(adapter).toBeInstanceOf(Adapter);
    expect(adapter).toBeInstanceOf(NetworkStubAdapter);
    expect(adapter.source).toBe(source);
    expect(typeof adapter.fetch).toBe('function');
  });

  it('answers not_configured while disabled, credentials or not', async () => {
    const configs = [Config.parse({}), { enabled: false }, { enabled: false, ...CREDENTIALS }];
    for (const config of configs) {
      const response = await create(config, frozen).fetch(request(), opts);
      expect(response).toEqual(notConfigured);
      expect(DemandResponse.parse(response)).toEqual(response);
    }
  });

  it('answers not_configured when enabled without both credentials', async () => {
    const configs = [
      { enabled: true },
      { enabled: true, api_key: CREDENTIALS.api_key },
      { enabled: true, base_url: CREDENTIALS.base_url },
      // The schema rejects blanks; the adapter still treats them as missing.
      { enabled: true, api_key: '', base_url: '   ' },
    ];
    for (const config of configs) {
      expect(await create(config, frozen).fetch(request(), opts)).toEqual(notConfigured);
    }
  });

  it('answers not_implemented when enabled with credentials and never reaches for fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('the network must not be reached')));
    vi.stubGlobal('fetch', fetchSpy);
    const adapter = create({ enabled: true, ...CREDENTIALS }, frozen);
    const response = await adapter.fetch(request(), opts);
    expect(response).toEqual({
      source,
      candidates: [],
      latency_ms: 0,
      error: NETWORK_NOT_IMPLEMENTED,
    });
    expect(DemandResponse.parse(response)).toEqual(response);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('measures latency_ms with the injected clock and survives a throwing one', async () => {
    let tick = 1_000;
    const now = () => {
      const value = tick;
      tick += 7;
      return value;
    };
    const timed = await create({ enabled: true, ...CREDENTIALS }, { now }).fetch(request(), opts);
    expect(timed.latency_ms).toBe(7);
    const broken = () => {
      throw new Error('clock');
    };
    const unclocked = await create({ enabled: false }, { now: broken }).fetch(request(), opts);
    expect(unclocked).toEqual(notConfigured);
  });

  it('honours an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await create({ enabled: true, ...CREDENTIALS }, frozen).fetch(request(), {
      ...opts,
      signal: controller.signal,
    });
    expect(response).toEqual({ source, candidates: [], latency_ms: 0, error: 'aborted' });
  });

  it('never rejects, even on options that are not what the types promise', async () => {
    const adapter = create({ enabled: true, ...CREDENTIALS }, frozen);
    const response = await adapter.fetch(request(), null as unknown as typeof opts);
    expect(response.candidates).toEqual([]);
    expect(response.error).toMatch(/^TypeError: /);
    expect(DemandResponse.parse(response)).toEqual(response);
  });

  it('keeps no credential on the adapter instance', () => {
    const adapter = create({ enabled: true, ...CREDENTIALS });
    const serialized = JSON.stringify(adapter);
    expect(serialized).not.toContain(CREDENTIALS.api_key);
    expect(serialized).not.toContain(CREDENTIALS.base_url);
  });

  describe('file header', () => {
    const text = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const header = /\/\*\*[\s\S]*?\*\//.exec(text)?.[0] ?? '';

    it('references docs/decisions.md item 10 by name and number', () => {
      expect(header).toContain('decisions.md');
      expect(header).toContain('10');
      expect(header).toMatch(/docs\/decisions\.md item 10/);
    });

    it('documents the expected request and response shape and the partner docs placeholder', () => {
      expect(header).toContain('TODO');
      expect(header).toContain('Partner docs: TBD');
      const terms = [
        'app_id',
        'categories',
        'region',
        'locale',
        'surface',
        'max_candidates',
        'headline',
        'ecpm_estimate',
      ];
      for (const term of terms) {
        expect(header, term).toContain(term);
      }
    });
  });
});

describe('isNetworkConfigured', () => {
  it('needs enabled: true plus a non-blank api_key and base_url', () => {
    expect(isNetworkConfigured({ enabled: true, ...CREDENTIALS })).toBe(true);
    expect(isNetworkConfigured({ enabled: false, ...CREDENTIALS })).toBe(false);
    expect(isNetworkConfigured({ enabled: true })).toBe(false);
    expect(isNetworkConfigured({ enabled: true, api_key: 'k' })).toBe(false);
    expect(isNetworkConfigured({ enabled: true, base_url: 'u' })).toBe(false);
    expect(isNetworkConfigured({ enabled: true, api_key: ' ', base_url: 'u' })).toBe(false);
    expect(isNetworkConfigured(KoahConfig.parse({}))).toBe(false);
    expect(isNetworkConfigured(GravityConfig.parse({ enabled: true, ...CREDENTIALS }))).toBe(true);
  });
});

describe('mediate() with the partner stubs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('still serves the direct candidate when both stubs are disabled', async () => {
    const adapters = [
      createDirectAdapter([creative()], frozen),
      createKoahAdapter(KoahConfig.parse({}), frozen),
      createGravityAdapter(GravityConfig.parse({}), frozen),
    ];
    const pending = mediate(adapters, request(), NO_EXCLUSIONS, frozen);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.selected?.id).toBe('cr_01');
    expect(result.selected_source).toBe('direct');
    expect(result.trace).toEqual({
      requested: ['direct', 'koah', 'gravity'],
      responses: [
        { source: 'direct', candidates: 1, latency_ms: 0 },
        { source: 'koah', candidates: 0, latency_ms: 0, error: NETWORK_NOT_CONFIGURED },
        { source: 'gravity', candidates: 0, latency_ms: 0, error: NETWORK_NOT_CONFIGURED },
      ],
      excluded: [],
      selected: 'direct',
    });
    expect(DemandTrace.parse(result.trace)).toEqual(result.trace);
  });

  it('records not_implemented for an enabled stub; stubs alone are no fill', async () => {
    const koah = createKoahAdapter({ enabled: true, ...CREDENTIALS }, frozen);
    const gravity = createGravityAdapter({ enabled: true, ...CREDENTIALS }, frozen);
    const direct = createDirectAdapter([creative()], frozen);

    const withDirect = mediate([koah, direct, gravity], request(), NO_EXCLUSIONS, frozen);
    await vi.runAllTimersAsync();
    const served = await withDirect;
    expect(served.selected_source).toBe('direct');
    expect(served.trace.responses).toEqual([
      { source: 'koah', candidates: 0, latency_ms: 0, error: NETWORK_NOT_IMPLEMENTED },
      { source: 'direct', candidates: 1, latency_ms: 0 },
      { source: 'gravity', candidates: 0, latency_ms: 0, error: NETWORK_NOT_IMPLEMENTED },
    ]);

    const alone = mediate([koah, gravity], request(), NO_EXCLUSIONS, frozen);
    await vi.runAllTimersAsync();
    const noFill = await alone;
    expect(noFill.selected).toBeNull();
    expect(noFill.selected_source).toBeNull();
    expect(noFill.trace.selected).toBeNull();
    expect(DemandTrace.parse(noFill.trace)).toEqual(noFill.trace);
  });
});
