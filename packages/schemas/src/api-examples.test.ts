/**
 * Every JSON example in docs/api.md, copied verbatim, must parse with its matching schema.
 * Keep these in sync by hand when the contract doc changes (a human decision, see CLAUDE.md).
 */
import { describe, expect, it } from 'vitest';

import { ErrorResponse, HealthResponse } from './common.js';
import { EvaluateRequest, EvaluateResponse } from './evaluate.js';
import { AttestRequest, EventRequest } from './events.js';
import { VerifyResponse } from './verify.js';

export const EVALUATE_REQUEST_EXAMPLE = {
  app_id: 'app_01J...',
  conversation_id: 'conv_abc',
  turn_id: 'turn_7',
  user: { tier: 'free', region: 'US', locale: 'en-US', user_hash: 'optional sha256' },
  messages: [{ role: 'user', content: 'which postgres hosting should I use for a side project' }],
  context_summary: 'optional alternative to raw messages',
  surface: { type: 'chat', placement: 'after_answer', max_creatives: 1 },
  policy_overrides: {},
};

export const EVALUATE_RESPONSE_EXAMPLE = {
  decision: 'serve',
  reason: null,
  classification: {
    commercial_intent: 0.84,
    categories: ['software.devtools.database'],
    sensitive: [],
    confidence: 0.91,
    method: 'llm',
    prompt_version: 'sha256:...',
  },
  creative: {
    id: 'cr_01J...',
    advertiser: 'Example DB Cloud',
    headline: 'Managed Postgres with a free tier',
    body: 'Spin up a database in 30 seconds.',
    cta: 'Try it free',
    url: 'https://<gateway>/c/aud_01J...',
    source: 'direct',
    disclosure_label: 'Sponsored',
  },
  audit_id: 'aud_01J...',
  latency_ms: 142,
};

export const ATTEST_REQUEST_EXAMPLE = {
  audit_id: 'aud_01J...',
  model_output_hash: 'sha256:...',
  rendered: true,
};

export const EVENT_REQUEST_EXAMPLE = {
  audit_id: 'aud_01J...',
  type: 'impression',
  ts: '2026-09-02T18:04:11Z',
  meta: {},
};

export const VERIFY_RESPONSE_EXAMPLE = {
  valid: true,
  checks: [
    { name: 'schema', ok: true },
    { name: 'record_hash', ok: true },
    { name: 'chain', ok: true },
    { name: 'signature', ok: true, detail: 'key_id=k_2026_09' },
    { name: 'creative_hash', ok: true },
    { name: 'disclosure_present', ok: true },
    { name: 'separation_attested', ok: true },
  ],
};

export const HEALTH_RESPONSE_EXAMPLE = { ok: true };

export const ERROR_RESPONSE_EXAMPLE = { error: { code: '...', message: '...' } };

describe('docs/api.md examples', () => {
  it('POST /v1/evaluate request parses as EvaluateRequest', () => {
    expect(EvaluateRequest.parse(EVALUATE_REQUEST_EXAMPLE)).toEqual(EVALUATE_REQUEST_EXAMPLE);
  });

  it('POST /v1/evaluate response parses as EvaluateResponse', () => {
    expect(EvaluateResponse.parse(EVALUATE_RESPONSE_EXAMPLE)).toEqual(EVALUATE_RESPONSE_EXAMPLE);
  });

  it('POST /v1/attest body parses as AttestRequest', () => {
    expect(AttestRequest.parse(ATTEST_REQUEST_EXAMPLE)).toEqual(ATTEST_REQUEST_EXAMPLE);
  });

  it('POST /v1/events body parses as EventRequest', () => {
    expect(EventRequest.parse(EVENT_REQUEST_EXAMPLE)).toEqual(EVENT_REQUEST_EXAMPLE);
  });

  it('GET /v1/verify/:id response parses as VerifyResponse', () => {
    expect(VerifyResponse.parse(VERIFY_RESPONSE_EXAMPLE)).toEqual(VERIFY_RESPONSE_EXAMPLE);
  });

  it('GET /healthz response parses as HealthResponse', () => {
    expect(HealthResponse.parse(HEALTH_RESPONSE_EXAMPLE)).toEqual(HEALTH_RESPONSE_EXAMPLE);
  });

  it('error body parses as ErrorResponse', () => {
    expect(ErrorResponse.parse(ERROR_RESPONSE_EXAMPLE)).toEqual(ERROR_RESPONSE_EXAMPLE);
  });
});
