import { describe, expect, it } from 'vitest';

import * as sdk from './index.js';

describe('@adgateio/sdk public surface', () => {
  it('exports the client factory, the hash helper and the guard', () => {
    expect(typeof sdk.createClient).toBe('function');
    expect(typeof sdk.hashModelOutput).toBe('function');
    expect(typeof sdk.isEvaluateResponse).toBe('function');
    expect(typeof sdk.failClosedEvaluate).toBe('function');
    expect(typeof sdk.withGeneration).toBe('function');
    expect(typeof sdk.forStream).toBe('function');
    expect(sdk.DEFAULT_TIMEOUT_MS).toBe(800);
    expect(sdk.CLIENT_FAILURE_PROMPT_VERSION).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sdk.EVALUATE_PATH).toBe('/v1/evaluate');
    expect(sdk.ATTEST_PATH).toBe('/v1/attest');
    expect(sdk.EVENTS_PATH).toBe('/v1/events');
  });

  it('exports nothing else at runtime (the rest of the surface is types)', () => {
    expect(Object.keys(sdk).sort()).toEqual([
      'ATTEST_PATH',
      'CLIENT_FAILURE_PROMPT_SEED',
      'CLIENT_FAILURE_PROMPT_VERSION',
      'DEFAULT_TIMEOUT_MS',
      'EVALUATE_PATH',
      'EVENTS_PATH',
      'createClient',
      'failClosedEvaluate',
      'forStream',
      'hashModelOutput',
      'isEvaluateResponse',
      'withGeneration',
    ]);
  });
});
