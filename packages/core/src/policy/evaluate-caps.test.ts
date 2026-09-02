import type { CapState, PolicyRule, User } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { evaluatePolicy, type PolicyEvaluation } from './evaluate.js';
import { FREE_US_USER, defaultPolicy, serveInput } from './evaluate.fixture.js';

const decision = (result: PolicyEvaluation, rule: PolicyRule) =>
  result.decisions.find((entry) => entry.rule === rule);

const capState = (patch: Partial<CapState>): CapState => ({
  session_count: 0,
  day_count: 0,
  turns_since_last: null,
  ...patch,
});

const evaluateCaps = (
  caps: { per_session?: number; per_user_per_day?: number; min_turns_between?: number },
  state: Partial<CapState>,
  user: User = FREE_US_USER,
) =>
  evaluatePolicy(
    serveInput({
      policy: defaultPolicy({ frequency_caps: caps }),
      capState: capState(state),
      user,
    }),
  );

describe('evaluatePolicy frequency_caps', () => {
  describe('per_session', () => {
    it('passes one below the cap', () => {
      const result = evaluateCaps({ per_session: 1 }, { session_count: 0 });
      expect(result.allowed).toBe(true);
      expect(decision(result, 'frequency_caps')?.result).toBe('pass');
    });

    it('fails when the count equals the cap', () => {
      const result = evaluateCaps({ per_session: 1 }, { session_count: 1 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('frequency_cap');
      expect(decision(result, 'frequency_caps')?.result).toBe('fail');
    });

    it('fails above the cap and at the boundary of a larger cap', () => {
      expect(evaluateCaps({ per_session: 1 }, { session_count: 2 }).reason).toBe('frequency_cap');
      expect(evaluateCaps({ per_session: 3 }, { session_count: 2 }).allowed).toBe(true);
      expect(evaluateCaps({ per_session: 3 }, { session_count: 3 }).reason).toBe('frequency_cap');
    });

    it('a cap of 0 never serves', () => {
      expect(evaluateCaps({ per_session: 0 }, { session_count: 0 }).reason).toBe('frequency_cap');
    });
  });

  describe('per_user_per_day', () => {
    it('passes one below the cap and fails when the count equals it', () => {
      expect(evaluateCaps({ per_user_per_day: 3 }, { day_count: 2 }).allowed).toBe(true);
      expect(evaluateCaps({ per_user_per_day: 3 }, { day_count: 3 }).reason).toBe('frequency_cap');
      expect(evaluateCaps({ per_user_per_day: 3 }, { day_count: 4 }).reason).toBe('frequency_cap');
    });

    it('is ignored when the user has no user_hash (per_session applies only)', () => {
      const anonymous: User = { tier: 'free', region: 'US' };
      const result = evaluateCaps({ per_user_per_day: 3 }, { day_count: 99 }, anonymous);
      expect(result.allowed).toBe(true);
      expect(decision(result, 'frequency_caps')).toEqual({
        rule: 'frequency_caps',
        result: 'pass',
        detail: 'session=0/1 day=n/a turns_since=none',
      });
    });

    it('applies as soon as a user_hash is present', () => {
      const hashed: User = { tier: 'free', region: 'US', user_hash: 'sha256:abc' };
      expect(evaluateCaps({ per_user_per_day: 3 }, { day_count: 3 }, hashed).reason).toBe(
        'frequency_cap',
      );
    });
  });

  describe('min_turns_between', () => {
    it('passes when no ad has been served yet (turns_since_last is null)', () => {
      const result = evaluateCaps({ min_turns_between: 4 }, { turns_since_last: null });
      expect(result.allowed).toBe(true);
      expect(decision(result, 'frequency_caps')?.detail).toBe(
        'session=0/1 day=0/3 turns_since=none',
      );
    });

    it('passes when the turns since the last ad equal the minimum', () => {
      expect(evaluateCaps({ min_turns_between: 4 }, { turns_since_last: 4 }).allowed).toBe(true);
      expect(evaluateCaps({ min_turns_between: 4 }, { turns_since_last: 9 }).allowed).toBe(true);
    });

    it('fails one below the minimum', () => {
      const result = evaluateCaps({ min_turns_between: 4 }, { turns_since_last: 3 });
      expect(result.reason).toBe('frequency_cap');
      expect(decision(result, 'frequency_caps')).toEqual({
        rule: 'frequency_caps',
        result: 'fail',
        detail: 'session=0/1 day=0/3 turns_since=3',
      });
    });

    it('a minimum of 0 accepts consecutive turns', () => {
      expect(evaluateCaps({ min_turns_between: 0 }, { turns_since_last: 0 }).allowed).toBe(true);
    });
  });

  it('renders the docs/audit.md detail on pass and on fail', () => {
    const pass = evaluatePolicy(
      serveInput({ capState: { session_count: 0, day_count: 1, turns_since_last: 9 } }),
    );
    expect(decision(pass, 'frequency_caps')).toEqual({
      rule: 'frequency_caps',
      result: 'pass',
      detail: 'session=0/1 day=1/3 turns_since=9',
    });
    const fail = evaluatePolicy(
      serveInput({ capState: { session_count: 1, day_count: 3, turns_since_last: 2 } }),
    );
    expect(decision(fail, 'frequency_caps')).toEqual({
      rule: 'frequency_caps',
      result: 'fail',
      detail: 'session=1/1 day=3/3 turns_since=2',
    });
  });

  it('still records competitor_exclusions as pending after a cap failure', () => {
    const result = evaluateCaps({ per_session: 1 }, { session_count: 1 });
    expect(decision(result, 'competitor_exclusions')).toEqual({
      rule: 'competitor_exclusions',
      result: 'pending',
    });
    expect(result.decisions).toHaveLength(7);
  });

  it('fails closed on a NaN counter', () => {
    const broken = { session_count: Number.NaN, day_count: 0, turns_since_last: null };
    expect(evaluatePolicy(serveInput({ capState: broken })).reason).toBe('frequency_cap');
    const brokenTurns = { session_count: 0, day_count: 0, turns_since_last: Number.NaN };
    expect(evaluatePolicy(serveInput({ capState: brokenTurns })).reason).toBe('frequency_cap');
  });
});
