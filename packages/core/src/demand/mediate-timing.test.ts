import { DemandTrace } from '@adgate/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDirectAdapter } from './direct.js';
import { creative, request } from './direct.fixture.js';
import { FakeAdapter, NO_EXCLUSIONS, candidate, respond } from './mediate.fixture.js';
import {
  ADAPTER_ERROR_PREFIX,
  MEDIATION_ABORTED_ERROR,
  MEDIATION_TIMEOUT_ERROR,
  type MediationResult,
  mediate,
} from './mediate.js';
import { DEFAULT_DEMAND_TIMEOUT_MS } from './types.js';

/**
 * Parallelism, per-adapter timeouts, failing adapters, cancellation and timer hygiene. Fake
 * timers throughout; afterEach proves no timer outlives any call.
 */
const track = (pending: Promise<MediationResult>) => {
  const state = { settled: false };
  const tracked = pending.then((result) => {
    state.settled = true;
    return result;
  });
  return { state, tracked };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe('mediate: timing', () => {
  it('a slow adapter does not delay a fast one beyond the timeout', async () => {
    const fast = respond('direct', [candidate('cr_fast')], { delayMs: 20 });
    const slow = new FakeAdapter('koah', { kind: 'hang' });
    const { state, tracked } = track(
      mediate([fast, slow], request(), NO_EXCLUSIONS, { timeoutMs: 100 }),
    );

    await vi.advanceTimersByTimeAsync(99);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    const result = await tracked;

    expect(result.trace.responses).toEqual([
      { source: 'direct', candidates: 1, latency_ms: 20 },
      { source: 'koah', candidates: 0, latency_ms: 100, error: MEDIATION_TIMEOUT_ERROR },
    ]);
    expect(result.selected?.id).toBe('cr_fast');
    expect(result.trace.selected).toBe('direct');
    expect(fast.lastOptions?.timeoutMs).toBe(100);
    expect(fast.lastOptions?.signal?.aborted).toBe(false);
    expect(slow.lastOptions?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs adapters in parallel: settles when the slowest answers, not after the sum', async () => {
    const adapters = [
      respond('direct', [], { delayMs: 38 }),
      respond('affiliate', [], { delayMs: 61 }),
    ];
    const { state, tracked } = track(mediate(adapters, request(), NO_EXCLUSIONS));
    await vi.advanceTimersByTimeAsync(60);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    expect((await tracked).trace.responses.map((r) => r.latency_ms)).toEqual([38, 61]);
  });

  it('defaults timeoutMs to DEFAULT_DEMAND_TIMEOUT_MS and falls back to it for a bad value', async () => {
    const hang = new FakeAdapter('gravity', { kind: 'hang' });
    const { state, tracked } = track(mediate([hang], request(), NO_EXCLUSIONS));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEMAND_TIMEOUT_MS - 1);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await tracked).trace.responses).toEqual([
      { source: 'gravity', candidates: 0, latency_ms: 250, error: 'timeout' },
    ]);
    expect(hang.lastOptions?.timeoutMs).toBe(250);

    const again = mediate([new FakeAdapter('koah', { kind: 'hang' })], request(), NO_EXCLUSIONS, {
      timeoutMs: Number.NaN,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect((await again).trace.responses[0]?.latency_ms).toBe(250);
  });

  it('ignores an answer that arrives after the timeout', async () => {
    const late = respond('direct', [candidate('cr_late', { ecpm: 99, match: 1 })], {
      delayMs: 300,
    });
    const pending = mediate([late], request(), NO_EXCLUSIONS, { timeoutMs: 100 });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.selected).toBeNull();
    expect(result.trace.responses).toEqual([
      { source: 'direct', candidates: 0, latency_ms: 100, error: 'timeout' },
    ]);
  });
});

describe('mediate: failing adapters', () => {
  it('all adapters failing returns selected null without throwing, one entry each', async () => {
    const adapters = [
      new FakeAdapter('direct', { kind: 'throw' }),
      new FakeAdapter('affiliate', { kind: 'reject' }),
      new FakeAdapter('koah', { kind: 'hang' }),
      new FakeAdapter('gravity', { kind: 'malformed' }),
      respond('affiliate', [], { error: 'affiliate_not_configured' }),
    ];
    const pending = mediate(adapters, request(), NO_EXCLUSIONS, { timeoutMs: 100 });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.selected).toBeNull();
    expect(result.selected_source).toBeNull();
    expect(result.trace.selected).toBeNull();
    expect(result.trace.requested).toEqual(['direct', 'affiliate', 'koah', 'gravity', 'affiliate']);
    expect(result.trace.responses).toEqual([
      { source: 'direct', candidates: 0, latency_ms: 0, error: 'adapter_error:TypeError' },
      { source: 'affiliate', candidates: 0, latency_ms: 0, error: 'adapter_error:RangeError' },
      { source: 'koah', candidates: 0, latency_ms: 100, error: 'timeout' },
      { source: 'gravity', candidates: 0, latency_ms: 0, error: 'adapter_error:InvalidResponse' },
      { source: 'affiliate', candidates: 0, latency_ms: 0, error: 'affiliate_not_configured' },
    ]);
    for (const response of result.trace.responses) {
      expect(Number.isInteger(response.latency_ms)).toBe(true);
      expect(response.latency_ms).toBeGreaterThanOrEqual(0);
    }
    expect(DemandTrace.parse(result.trace)).toEqual(result.trace);
    expect(ADAPTER_ERROR_PREFIX).toBe('adapter_error:');
  });

  it('records the error name only, never its message', async () => {
    const adapters = [
      new FakeAdapter('direct', { kind: 'throw', error: new Error('the user said secret') }),
      new FakeAdapter('affiliate', { kind: 'reject', error: 'a plain string secret' }),
      new FakeAdapter('koah', {
        kind: 'reject',
        error: Object.assign(new Error('secret'), { name: '' }),
      }),
    ];
    const pending = mediate(adapters, request(), NO_EXCLUSIONS);
    await vi.runAllTimersAsync();
    const { trace } = await pending;
    expect(trace.responses.map((r) => r.error)).toEqual([
      'adapter_error:Error',
      'adapter_error:NonError',
      'adapter_error:NonError',
    ]);
    expect(JSON.stringify(trace)).not.toContain('secret');
  });

  it('drops an empty error string and cuts a long one to 200 characters', async () => {
    const adapters = [
      respond('direct', [], { error: '' }),
      respond('affiliate', [], { error: 'x'.repeat(500) }),
    ];
    const pending = mediate(adapters, request(), NO_EXCLUSIONS);
    await vi.runAllTimersAsync();
    const { trace } = await pending;
    expect(trace.responses[0]).toEqual({ source: 'direct', candidates: 0, latency_ms: 0 });
    expect(trace.responses[1]?.error).toHaveLength(200);
    expect(DemandTrace.parse(trace)).toEqual(trace);
  });

  it('survives a throwing clock and garbage input without throwing', async () => {
    const withClock = mediate([respond('direct', [candidate('cr_1')])], request(), NO_EXCLUSIONS, {
      now: () => {
        throw new Error('clock');
      },
    });
    await vi.runAllTimersAsync();
    const clocked = await withClock;
    expect(clocked.selected?.id).toBe('cr_1');
    expect(clocked.trace.responses).toEqual([{ source: 'direct', candidates: 1, latency_ms: 0 }]);

    const garbage = await mediate(null as never, request(), NO_EXCLUSIONS);
    expect(garbage).toEqual({
      selected: null,
      selected_source: null,
      trace: { requested: [], responses: [], excluded: [], selected: null },
    });
  });

  it('the last-resort path still writes one entry per requested source, error name only', async () => {
    const noPolicy = await mediate(
      [respond('direct', [candidate('cr_1')]), respond('affiliate', [])],
      request(),
      null as never,
    );
    expect(noPolicy.selected).toBeNull();
    expect(noPolicy.selected_source).toBeNull();
    expect(noPolicy.trace).toEqual({
      requested: ['direct', 'affiliate'],
      responses: [
        { source: 'direct', candidates: 0, latency_ms: 0, error: 'adapter_error:TypeError' },
        { source: 'affiliate', candidates: 0, latency_ms: 0, error: 'adapter_error:TypeError' },
      ],
      excluded: [],
      selected: null,
    });
    expect(DemandTrace.parse(noPolicy.trace)).toEqual(noPolicy.trace);
    const noRequest = await mediate([respond('koah', [])], null as never, NO_EXCLUSIONS);
    expect(noRequest.trace.responses).toEqual([
      { source: 'koah', candidates: 0, latency_ms: 0, error: 'adapter_error:TypeError' },
    ]);
    // A policy whose competitor_exclusions getter throws a message: the message never lands.
    const leaky = {
      get competitor_exclusions(): string[] {
        throw new Error('the user said secret');
      },
    };
    const leaked = await mediate([respond('direct', [candidate('cr_1')])], request(), leaky);
    expect(leaked.trace.responses).toEqual([
      { source: 'direct', candidates: 0, latency_ms: 0, error: 'adapter_error:Error' },
    ]);
    expect(JSON.stringify(leaked)).not.toContain('secret');
  });

  it('an adapter that throws inside its own selection reaches the trace by error name only', async () => {
    // DirectAdapter catches the throw itself and reports describeError(); mediate copies that
    // string verbatim into the signed trace, so the adapter side must never carry a message.
    const trap = creative({ id: 'cr_trap' });
    Object.defineProperty(trap, 'active', {
      get() {
        throw new Error('secret message');
      },
    });
    const pending = mediate([createDirectAdapter([trap])], request(), NO_EXCLUSIONS);
    await vi.runAllTimersAsync();
    const { trace } = await pending;
    expect(trace.responses).toEqual([
      { source: 'direct', candidates: 0, latency_ms: 0, error: 'Error' },
    ]);
    expect(JSON.stringify(trace)).not.toContain('secret');
  });
});

describe('mediate: cancellation', () => {
  it('an already aborted signal calls no adapter and records aborted for each', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapters = [
      respond('direct', [candidate('cr_1')]),
      new FakeAdapter('koah', { kind: 'hang' }),
    ];
    const result = await mediate(adapters, request(), NO_EXCLUSIONS, { signal: controller.signal });
    expect(result.selected).toBeNull();
    expect(result.trace.responses).toEqual([
      { source: 'direct', candidates: 0, latency_ms: 0, error: MEDIATION_ABORTED_ERROR },
      { source: 'koah', candidates: 0, latency_ms: 0, error: 'aborted' },
    ]);
    expect(adapters.map((a) => a.calls)).toEqual([0, 0]);
  });

  it('a caller abort mid-flight settles hanging adapters with aborted and clears the timers', async () => {
    const controller = new AbortController();
    const hang = new FakeAdapter('koah', { kind: 'hang' });
    const done = respond('direct', [candidate('cr_1')], { delayMs: 5 });
    const { state, tracked } = track(
      mediate([done, hang], request(), NO_EXCLUSIONS, {
        timeoutMs: 100,
        signal: controller.signal,
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(state.settled).toBe(false);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    const result = await tracked;
    expect(result.trace.responses).toEqual([
      { source: 'direct', candidates: 1, latency_ms: 5 },
      { source: 'koah', candidates: 0, latency_ms: 10, error: 'aborted' },
    ]);
    expect(result.selected?.id).toBe('cr_1');
    expect(hang.lastOptions?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
