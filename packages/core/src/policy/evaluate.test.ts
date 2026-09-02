import {
  POLICY_RULES,
  type ContentCategory,
  type PolicyConfig,
  type PolicyRule,
  type SensitiveCategory,
} from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { evaluatePolicy, type PolicyEvaluation } from './evaluate.js';
import {
  CHAT_SURFACE,
  FREE_US_USER,
  SERVE_CLASSIFICATION,
  defaultPolicy,
  serveInput,
} from './evaluate.fixture.js';

const decision = (result: PolicyEvaluation, rule: PolicyRule) =>
  result.decisions.find((entry) => entry.rule === rule);
const results = (result: PolicyEvaluation) => result.decisions.map((entry) => entry.result);

describe('evaluatePolicy', () => {
  it('allows the docs/api.md example and records the docs/audit.md decisions verbatim', () => {
    const result = evaluatePolicy(
      serveInput({ capState: { session_count: 0, day_count: 1, turns_since_last: 9 } }),
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.decisions).toEqual([
      { rule: 'serve_to_tiers', result: 'pass' },
      { rule: 'regions', result: 'pass' },
      { rule: 'blocked_categories', result: 'pass' },
      { rule: 'min_confidence', result: 'pass' },
      { rule: 'min_commercial_intent', result: 'pass' },
      { rule: 'frequency_caps', result: 'pass', detail: 'session=0/1 day=1/3 turns_since=9' },
      { rule: 'competitor_exclusions', result: 'pending' },
    ]);
  });

  it('runs every rule in documented order and records all seven even when all fail', () => {
    const result = evaluatePolicy(
      serveInput({
        user: { tier: 'paid', region: 'BR', user_hash: 'sha256:u' },
        classification: {
          ...SERVE_CLASSIFICATION,
          sensitive: ['health'],
          confidence: 0.1,
          commercial_intent: 0.1,
        },
        capState: { session_count: 1, day_count: 3, turns_since_last: 0 },
      }),
    );
    expect(result.decisions.map((entry) => entry.rule)).toEqual([...POLICY_RULES]);
    expect(results(result)).toEqual(['fail', 'fail', 'fail', 'fail', 'fail', 'fail', 'pending']);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('paid_user');
  });

  it('takes the reason from the first failing rule only', () => {
    const result = evaluatePolicy(
      serveInput({
        user: { tier: 'free', region: 'BR' },
        classification: { ...SERVE_CLASSIFICATION, confidence: 0.2 },
      }),
    );
    expect(result.reason).toBe('region_blocked');
    expect(results(result)).toEqual(['pass', 'fail', 'pass', 'fail', 'pass', 'pass', 'pending']);
  });

  it('does not mutate its input and returns fresh decision objects', () => {
    const input = serveInput();
    const snapshot = structuredClone(input);
    const first = evaluatePolicy(input);
    const second = evaluatePolicy(input);
    expect(input).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(first.decisions).not.toBe(second.decisions);
    expect(first.decisions[0]).not.toBe(second.decisions[0]);
  });

  describe('serve_to_tiers', () => {
    it('suppresses a paid user under the default policy with reason paid_user', () => {
      const result = evaluatePolicy(serveInput({ user: { ...FREE_US_USER, tier: 'paid' } }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('paid_user');
      expect(decision(result, 'serve_to_tiers')).toEqual({
        rule: 'serve_to_tiers',
        result: 'fail',
        detail: 'tier=paid not in serve_to_tiers',
      });
    });

    it('suppresses any tier that is not listed, not only paid', () => {
      const result = evaluatePolicy(serveInput({ user: { ...FREE_US_USER, tier: 'enterprise' } }));
      expect(result.reason).toBe('paid_user');
    });

    it('serves a paid user only when the policy lists the tier with allow_paid_tiers', () => {
      const policy = defaultPolicy({ serve_to_tiers: ['free', 'paid'], allow_paid_tiers: true });
      const result = evaluatePolicy(
        serveInput({ policy, user: { ...FREE_US_USER, tier: 'paid' } }),
      );
      expect(result.allowed).toBe(true);
      expect(decision(result, 'serve_to_tiers')).toEqual({
        rule: 'serve_to_tiers',
        result: 'pass',
      });
    });

    it('guards allow_paid_tiers itself when a hand-built policy bypassed the schema', () => {
      const policy: PolicyConfig = {
        ...defaultPolicy(),
        serve_to_tiers: ['free', 'paid'],
        allow_paid_tiers: false,
      };
      const result = evaluatePolicy(
        serveInput({ policy, user: { ...FREE_US_USER, tier: 'paid' } }),
      );
      expect(result.reason).toBe('paid_user');
      expect(decision(result, 'serve_to_tiers')?.detail).toBe(
        'tier=paid requires allow_paid_tiers',
      );
    });
  });

  describe('blocked_categories', () => {
    const confident = { ...SERVE_CLASSIFICATION, commercial_intent: 0.95, confidence: 0.99 };

    it('suppresses a health query even with commercial intent 0.95', () => {
      const result = evaluatePolicy(
        serveInput({ classification: { ...confident, sensitive: ['health'] } }),
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('sensitive_category:health');
      expect(decision(result, 'blocked_categories')).toEqual({
        rule: 'blocked_categories',
        result: 'fail',
        detail: 'health in sensitive',
      });
      expect(decision(result, 'min_commercial_intent')?.result).toBe('pass');
    });

    it('checks classification.categories too, not only sensitive', () => {
      // The content taxonomy has no sensitive names today; a future classifier might leak one.
      const leaked = 'health' as ContentCategory;
      const result = evaluatePolicy(
        serveInput({ classification: { ...confident, categories: [leaked], sensitive: [] } }),
      );
      expect(result.reason).toBe('sensitive_category:health');
      expect(decision(result, 'blocked_categories')?.detail).toBe('health in categories');
    });

    it('names the first blocked category in policy order', () => {
      const result = evaluatePolicy(
        serveInput({ classification: { ...confident, sensitive: ['gambling', 'finance'] } }),
      );
      // The default list is health, finance, politics, legal, adult, gambling, ...
      expect(result.reason).toBe('sensitive_category:finance');
    });

    it('lets a sensitive signal through when the policy does not block it', () => {
      const policy = defaultPolicy({ blocked_categories: ['self_harm'] });
      const result = evaluatePolicy(
        serveInput({ policy, classification: { ...confident, sensitive: ['health'] } }),
      );
      expect(result.allowed).toBe(true);
    });

    it('always blocks self_harm even when a hand-built policy dropped it', () => {
      const policy: PolicyConfig = {
        ...defaultPolicy(),
        blocked_categories: ['health'] as SensitiveCategory[],
      };
      const result = evaluatePolicy(
        serveInput({ policy, classification: { ...confident, sensitive: ['self_harm'] } }),
      );
      expect(result.reason).toBe('sensitive_category:self_harm');
    });
  });

  describe('min_confidence and min_commercial_intent', () => {
    it('suppresses low confidence and passes when equal to the threshold', () => {
      const low = evaluatePolicy(
        serveInput({ classification: { ...SERVE_CLASSIFICATION, confidence: 0.69 } }),
      );
      expect(low.allowed).toBe(false);
      expect(low.reason).toBe('low_confidence');
      expect(decision(low, 'min_confidence')).toEqual({
        rule: 'min_confidence',
        result: 'fail',
        detail: 'confidence=0.69 min=0.7',
      });
      const equal = evaluatePolicy(
        serveInput({ classification: { ...SERVE_CLASSIFICATION, confidence: 0.7 } }),
      );
      expect(equal.allowed).toBe(true);
    });

    it('suppresses low commercial intent and passes when equal to the threshold', () => {
      const low = evaluatePolicy(
        serveInput({ classification: { ...SERVE_CLASSIFICATION, commercial_intent: 0.59 } }),
      );
      expect(low.reason).toBe('low_commercial_intent');
      expect(decision(low, 'min_commercial_intent')).toEqual({
        rule: 'min_commercial_intent',
        result: 'fail',
        detail: 'commercial_intent=0.59 min=0.6',
      });
      const equal = evaluatePolicy(
        serveInput({ classification: { ...SERVE_CLASSIFICATION, commercial_intent: 0.6 } }),
      );
      expect(equal.allowed).toBe(true);
    });

    it('reports low_confidence before low_commercial_intent when both fail', () => {
      const result = evaluatePolicy(
        serveInput({
          classification: { ...SERVE_CLASSIFICATION, confidence: 0.1, commercial_intent: 0.1 },
        }),
      );
      expect(result.reason).toBe('low_confidence');
      expect(decision(result, 'min_commercial_intent')?.result).toBe('fail');
    });

    it('fails closed on a NaN score', () => {
      const result = evaluatePolicy(
        serveInput({ classification: { ...SERVE_CLASSIFICATION, confidence: Number.NaN } }),
      );
      expect(result.reason).toBe('low_confidence');
    });
  });

  describe('competitor_exclusions', () => {
    it('is recorded as pending with and without exclusions, allowed or not', () => {
      const pending = { rule: 'competitor_exclusions', result: 'pending' };
      expect(decision(evaluatePolicy(serveInput()), 'competitor_exclusions')).toEqual(pending);
      const policy = defaultPolicy({ competitor_exclusions: ['rival.com'] });
      expect(decision(evaluatePolicy(serveInput({ policy })), 'competitor_exclusions')).toEqual(
        pending,
      );
      const suppressed = evaluatePolicy(serveInput({ policy, user: { tier: 'paid' } }));
      expect(decision(suppressed, 'competitor_exclusions')).toEqual(pending);
      expect(suppressed.reason).toBe('paid_user');
    });
  });

  it('accepts every surface type without changing the decisions', () => {
    const chat = evaluatePolicy(serveInput({ surface: CHAT_SURFACE }));
    const agent = evaluatePolicy(
      serveInput({ surface: { type: 'agent', placement: 'after_answer' } }),
    );
    const cli = evaluatePolicy(serveInput({ surface: { type: 'cli', placement: 'after_answer' } }));
    expect(agent).toEqual(chat);
    expect(cli).toEqual(chat);
  });
});
