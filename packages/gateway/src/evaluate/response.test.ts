import { failClosedClassification } from '@adgateio/core';
import { type Candidate, EvaluateResponse } from '@adgateio/schemas';
import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';

import { buildEvaluateResponse, clickUrl, errorEvaluateResponse, toCreative } from './response.js';

const CANDIDATE: Candidate = {
  id: 'cr_01J000000000000000000000AA',
  advertiser: 'Example DB Cloud',
  advertiser_domain: 'exampledb.dev',
  headline: 'Managed Postgres with a free tier',
  body: 'Spin up a database in 30 seconds.',
  cta: 'Try it free',
  url_template: 'https://exampledb.dev/?ref=adgate',
  target_categories: ['software.devtools.database'],
  target_regions: [],
  keywords: [],
  ecpm: 12,
  source: 'direct',
  active: true,
  ecpm_estimate: 12,
  targeting_match: 0.85,
  resolved_url: 'https://exampledb.dev/?ref=adgate',
};

const CLASSIFICATION = { ...failClosedClassification(), commercial_intent: 0.9, confidence: 0.95 };
const AUDIT_ID = 'aud_01J000000000000000000000AA';

describe('clickUrl', () => {
  it('points at the gateway redirect, tolerating a trailing slash on the base URL', () => {
    expect(clickUrl('https://gw.example', AUDIT_ID)).toBe(`https://gw.example/c/${AUDIT_ID}`);
    expect(clickUrl('https://gw.example///', AUDIT_ID)).toBe(`https://gw.example/c/${AUDIT_ID}`);
  });
});

describe('toCreative', () => {
  it('copies the copy, never the destination, and labels the block', () => {
    const creative = toCreative({
      candidate: CANDIDATE,
      source: 'direct',
      auditId: AUDIT_ID,
      publicBaseUrl: 'https://gw.example',
      disclosureLabel: 'Sponsored',
    });
    expect(creative).toEqual({
      id: CANDIDATE.id,
      advertiser: 'Example DB Cloud',
      headline: CANDIDATE.headline,
      body: CANDIDATE.body,
      cta: 'Try it free',
      url: `https://gw.example/c/${AUDIT_ID}`,
      source: 'direct',
      disclosure_label: 'Sponsored',
    });
    expect(JSON.stringify(creative)).not.toContain('exampledb.dev');
  });
});

describe('buildEvaluateResponse', () => {
  const base = { publicBaseUrl: 'https://gw.example', disclosureLabel: 'Sponsored', latencyMs: 12 };

  it('derives a serve response from the record and the winning candidate', () => {
    const response = buildEvaluateResponse({
      ...base,
      record: { id: AUDIT_ID, decision: 'serve', reason: null, classification: CLASSIFICATION },
      selected: CANDIDATE,
      selectedSource: 'direct',
    });
    expect(response.decision).toBe('serve');
    expect(response.creative?.url).toBe(`https://gw.example/c/${AUDIT_ID}`);
    expect(response.audit_id).toBe(AUDIT_ID);
    expect(response.latency_ms).toBe(12);
    expect(EvaluateResponse.parse(response)).toEqual(response);
  });

  it('derives a suppress response with a null creative even when a candidate is handed in', () => {
    const response = buildEvaluateResponse({
      ...base,
      record: {
        id: AUDIT_ID,
        decision: 'suppress',
        reason: 'no_fill',
        classification: CLASSIFICATION,
      },
      selected: CANDIDATE,
      selectedSource: 'direct',
    });
    expect(response).toMatchObject({ decision: 'suppress', reason: 'no_fill', creative: null });
  });

  it('throws when the record and the response cannot agree (a serve without a candidate)', () => {
    expect(() =>
      buildEvaluateResponse({
        ...base,
        record: { id: AUDIT_ID, decision: 'serve', reason: null, classification: CLASSIFICATION },
        selected: null,
        selectedSource: null,
      }),
    ).toThrow(ZodError);
  });
});

describe('errorEvaluateResponse', () => {
  it('is the documented suppress/error body with a zeroed classification', () => {
    const response = errorEvaluateResponse(AUDIT_ID, 3);
    expect(EvaluateResponse.parse(response)).toEqual({
      decision: 'suppress',
      reason: 'error',
      classification: failClosedClassification(),
      creative: null,
      audit_id: AUDIT_ID,
      latency_ms: 3,
    });
  });
});
