import { describe, expect, it } from 'vitest';

import { EVALUATE_REQUEST_EXAMPLE, EVALUATE_RESPONSE_EXAMPLE } from './api-examples.test.js';
import { EvaluateRequest, EvaluateResponse } from './evaluate.js';

const {
  messages: _messages,
  context_summary: _summary,
  ...requestWithoutText
} = EVALUATE_REQUEST_EXAMPLE;
void _messages;
void _summary;

describe('EvaluateRequest', () => {
  it('rejects when both messages and context_summary are absent', () => {
    const result = EvaluateRequest.safeParse(requestWithoutText);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'At least one of messages or context_summary is required',
    );
  });

  it('accepts messages without context_summary', () => {
    expect(
      EvaluateRequest.safeParse({
        ...requestWithoutText,
        messages: EVALUATE_REQUEST_EXAMPLE.messages,
      }).success,
    ).toBe(true);
  });

  it('accepts context_summary without messages', () => {
    expect(
      EvaluateRequest.safeParse({
        ...requestWithoutText,
        context_summary: 'looking for a database',
      }).success,
    ).toBe(true);
  });

  it('rejects an empty messages array as the only text', () => {
    expect(EvaluateRequest.safeParse({ ...requestWithoutText, messages: [] }).success).toBe(false);
  });

  it('rejects placements other than after_answer', () => {
    expect(
      EvaluateRequest.safeParse({
        ...EVALUATE_REQUEST_EXAMPLE,
        surface: { type: 'chat', placement: 'inline' },
      }).success,
    ).toBe(false);
  });

  it('accepts every surface type and only those', () => {
    for (const type of ['chat', 'agent', 'cli']) {
      const surface = { type, placement: 'after_answer' };
      expect(EvaluateRequest.safeParse({ ...EVALUATE_REQUEST_EXAMPLE, surface }).success).toBe(
        true,
      );
    }
    const surface = { type: 'web', placement: 'after_answer' };
    expect(EvaluateRequest.safeParse({ ...EVALUATE_REQUEST_EXAMPLE, surface }).success).toBe(false);
  });

  it('accepts any non-empty tier string and requires the app_ id prefix', () => {
    const user = { tier: 'enterprise' };
    expect(EvaluateRequest.safeParse({ ...EVALUATE_REQUEST_EXAMPLE, user }).success).toBe(true);
    expect(
      EvaluateRequest.safeParse({ ...EVALUATE_REQUEST_EXAMPLE, user: { tier: '' } }).success,
    ).toBe(false);
    expect(
      EvaluateRequest.safeParse({ ...EVALUATE_REQUEST_EXAMPLE, app_id: 'my-app' }).success,
    ).toBe(false);
  });

  it('strips unknown keys instead of failing', () => {
    const parsed = EvaluateRequest.parse({ ...EVALUATE_REQUEST_EXAMPLE, extra: 1 });
    expect(parsed).not.toHaveProperty('extra');
  });

  it('accepts deep-partial policy_overrides without back-filling defaults', () => {
    const policy_overrides = {
      min_confidence: 0.9,
      frequency_caps: { per_session: 0 },
      demand: [{ source: 'affiliate', enabled: false }],
    };
    const parsed = EvaluateRequest.parse({ ...EVALUATE_REQUEST_EXAMPLE, policy_overrides });
    expect(parsed.policy_overrides).toEqual(policy_overrides);
  });

  it('rejects unknown or invalid keys inside policy_overrides', () => {
    for (const policy_overrides of [
      { min_intent: 0.9 },
      { frequency_caps: { per_day: 1 } },
      { min_confidence: 2 },
      { blocked_categories: ['spam'] },
      'strict',
    ]) {
      expect(
        EvaluateRequest.safeParse({ ...EVALUATE_REQUEST_EXAMPLE, policy_overrides }).success,
      ).toBe(false);
    }
  });
});

describe('EvaluateResponse', () => {
  const suppressed = {
    ...EVALUATE_RESPONSE_EXAMPLE,
    decision: 'suppress',
    reason: 'sensitive_category:health',
    creative: null,
  };

  it('accepts a suppress response with a reason and no creative', () => {
    expect(EvaluateResponse.parse(suppressed)).toEqual(suppressed);
  });

  it('rejects serve with a null creative', () => {
    expect(
      EvaluateResponse.safeParse({ ...EVALUATE_RESPONSE_EXAMPLE, creative: null }).success,
    ).toBe(false);
  });

  it('rejects serve with a reason', () => {
    expect(
      EvaluateResponse.safeParse({ ...EVALUATE_RESPONSE_EXAMPLE, reason: 'no_fill' }).success,
    ).toBe(false);
  });

  it('rejects suppress with a creative', () => {
    expect(
      EvaluateResponse.safeParse({ ...suppressed, creative: EVALUATE_RESPONSE_EXAMPLE.creative })
        .success,
    ).toBe(false);
  });

  it('rejects suppress without a reason', () => {
    expect(EvaluateResponse.safeParse({ ...suppressed, reason: null }).success).toBe(false);
  });

  it('rejects an unknown suppress reason', () => {
    expect(
      EvaluateResponse.safeParse({ ...suppressed, reason: 'sensitive_category:unknown' }).success,
    ).toBe(false);
  });

  it('requires an audit_id with the aud_ prefix', () => {
    expect(
      EvaluateResponse.safeParse({ ...EVALUATE_RESPONSE_EXAMPLE, audit_id: '01J...' }).success,
    ).toBe(false);
  });

  it('rejects negative or fractional latency', () => {
    expect(
      EvaluateResponse.safeParse({ ...EVALUATE_RESPONSE_EXAMPLE, latency_ms: -1 }).success,
    ).toBe(false);
    expect(
      EvaluateResponse.safeParse({ ...EVALUATE_RESPONSE_EXAMPLE, latency_ms: 1.5 }).success,
    ).toBe(false);
  });
});
