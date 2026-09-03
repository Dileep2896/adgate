/**
 * Every JSON example in docs/api.md, extracted from the doc at test time (doc-examples.fixture.ts)
 * and looked up by the `## ` heading it sits under, must parse with its matching schema. The two
 * inline examples (healthz, the error body) are the only hand copies left.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { ErrorResponse, HealthResponse } from './common.js';
import { expectDocExamples } from './doc-examples.fixture.js';
import { EvaluateRequest, EvaluateResponse } from './evaluate.js';
import { AttestRequest, EventRequest } from './events.js';
import { VerifyResponse } from './verify.js';

const [evaluateRequest, evaluateResponse] = expectDocExamples('api.md', 'POST /v1/evaluate', 2);
const [attestRequest] = expectDocExamples('api.md', 'POST /v1/attest', 1);
const [eventRequest] = expectDocExamples('api.md', 'POST /v1/events', 1);
const [verifyResponse] = expectDocExamples('api.md', 'GET /v1/verify/:id', 1);

export const EVALUATE_REQUEST_EXAMPLE = evaluateRequest as z.input<typeof EvaluateRequest>;
export const EVALUATE_RESPONSE_EXAMPLE = evaluateResponse as z.input<typeof EvaluateResponse>;
export const ATTEST_REQUEST_EXAMPLE = attestRequest as z.input<typeof AttestRequest>;
export const EVENT_REQUEST_EXAMPLE = eventRequest as z.input<typeof EventRequest>;
export const VERIFY_RESPONSE_EXAMPLE = verifyResponse as z.input<typeof VerifyResponse>;

export const HEALTH_RESPONSE_EXAMPLE = { ok: true };

export const ERROR_RESPONSE_EXAMPLE = { error: { code: '...', message: '...' } };

describe('docs/api.md examples', () => {
  it('are read from the doc: the evaluate request is the documented one', () => {
    expect(EVALUATE_REQUEST_EXAMPLE.app_id).toBe('app_01J...');
    expect(EVALUATE_REQUEST_EXAMPLE.messages?.[0]?.content).toBe(
      'which postgres hosting should I use for a side project',
    );
    expect(VERIFY_RESPONSE_EXAMPLE.checks).toHaveLength(7);
  });

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
