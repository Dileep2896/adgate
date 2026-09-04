import { describe, expect, it } from 'vitest';

import {
  assertBucketOptions,
  type BucketState,
  decisionFromTokens,
  heldTokens,
  takeToken,
} from './limiter.js';

/** The bucket arithmetic under a clock the test moves by hand. */
const T0 = new Date('2026-09-03T12:00:00.000Z');
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const opts = { rps: 5, burst: 3 };

/** Takes `n` tokens back to back at `now`, returning the final state and every decision. */
const takeMany = (state: BucketState | null, now: Date, n: number) => {
  const decisions = [];
  let current = state;
  for (let index = 0; index < n; index += 1) {
    const result = takeToken(current, now, opts);
    current = result.state;
    decisions.push(result.decision);
  }
  return { state: current as BucketState, decisions };
};

describe('takeToken', () => {
  it('starts a new key with a full bucket and takes one token', () => {
    const { state, decision } = takeToken(null, T0, opts);
    expect(decision).toEqual({ allowed: true, retry_after_s: 0, remaining: 2 });
    expect(state).toEqual({ tokens: 2, updatedAt: T0 });
  });

  it('allows exactly burst requests in one instant, then refuses with Retry-After >= 1', () => {
    const { state, decisions } = takeMany(null, T0, 5);
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0, 0]);
    // One token at 5 per second is 0.2 s away; the header is whole seconds, at least 1.
    expect(decisions[3]?.retry_after_s).toBe(1);
    // A refused request is charged (-1) but the encoding says no token was really taken.
    expect(state.tokens).toBe(-1);
    expect(heldTokens(state, opts)).toBe(0);
  });

  it('refills at rps per second and never beyond the burst', () => {
    const { state: empty } = takeMany(null, T0, 3);
    // 200 ms at 5 rps = one token: allowed, nothing left.
    const after200 = takeToken(empty, at(200), opts);
    expect(after200.decision).toEqual({ allowed: true, retry_after_s: 0, remaining: 0 });
    expect(after200.state.tokens).toBeCloseTo(0, 9);
    // Another 100 ms is only half a token: refused, the half is kept.
    const after300 = takeToken(after200.state, at(300), opts);
    expect(after300.decision.allowed).toBe(false);
    expect(heldTokens(after300.state, opts)).toBeCloseTo(0.5, 9);
    // A long pause tops the bucket up to burst, not beyond: three pass again.
    const { decisions } = takeMany(after300.state, at(60_000), 4);
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
  });

  it('gives a refused request its charge back on the next refill (no penalty for retrying)', () => {
    const { state: refused } = takeMany(null, T0, 4);
    expect(refused.tokens).toBe(-1);
    // 200 ms later the bucket has exactly one token: the earlier refusal cost nothing.
    const next = takeToken(refused, at(200), opts);
    expect(next.decision.allowed).toBe(true);
    expect(next.state.tokens).toBeCloseTo(0, 9);
  });

  it('reports Retry-After in whole seconds rounded up from the missing fraction', () => {
    const slow = { rps: 0.5, burst: 1 };
    const first = takeToken(null, T0, slow);
    expect(first.decision.allowed).toBe(true);
    const second = takeToken(first.state, at(500), slow);
    // 0.25 tokens refilled; 0.75 missing at 0.5 per second = 1.5 s -> 2.
    expect(second.decision).toEqual({ allowed: false, retry_after_s: 2, remaining: 0 });
  });

  it('refills nothing when the clock went backwards and keeps the later timestamp', () => {
    const { state } = takeMany(null, T0, 3);
    const earlier = takeToken(state, at(-5_000), opts);
    expect(earlier.decision.allowed).toBe(false);
    expect(earlier.state.updatedAt).toEqual(T0);
    expect(heldTokens(earlier.state, opts)).toBe(0);
  });

  it('keeps keys apart: the state is per bucket', () => {
    const a = takeMany(null, T0, 3).state;
    const b = takeToken(null, T0, opts);
    expect(takeToken(a, T0, opts).decision.allowed).toBe(false);
    expect(b.decision.allowed).toBe(true);
  });
});

describe('decisionFromTokens', () => {
  it('reads the verdict from the sign and floors the remainder', () => {
    expect(decisionFromTokens(2.9, 5)).toEqual({ allowed: true, retry_after_s: 0, remaining: 2 });
    expect(decisionFromTokens(0, 5)).toEqual({ allowed: true, retry_after_s: 0, remaining: 0 });
    expect(decisionFromTokens(-0.5, 5)).toEqual({ allowed: false, retry_after_s: 1, remaining: 0 });
    expect(decisionFromTokens(-1, 0.25)).toEqual({
      allowed: false,
      retry_after_s: 4,
      remaining: 0,
    });
  });
});

describe('assertBucketOptions', () => {
  it('rejects a non-positive rate and a burst below one or fractional', () => {
    expect(() => assertBucketOptions({ rps: 0, burst: 1 })).toThrow(TypeError);
    expect(() => assertBucketOptions({ rps: Number.NaN, burst: 1 })).toThrow(TypeError);
    expect(() => assertBucketOptions({ rps: 1, burst: 0 })).toThrow(TypeError);
    expect(() => assertBucketOptions({ rps: 1, burst: 1.5 })).toThrow(TypeError);
    expect(() => assertBucketOptions({ rps: 0.5, burst: 1 })).not.toThrow();
  });
});
