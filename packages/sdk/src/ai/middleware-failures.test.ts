import { wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { ATTEST_PATH, EVALUATE_PATH } from '../client.js';
import { AUDIT_ID, bodyOf, callsTo, emptyResponse } from '../test-support.js';
import type { EvaluateResult } from '../types.js';
import { adgateMiddleware } from './middleware.js';
import {
  adgateMetadataOf as adgateOf,
  ANSWER,
  attestCalls,
  callParams,
  fakeClient,
  userPrompt,
  wrapGenerating,
} from './test-support.js';

/**
 * The never-throws guarantee: whatever adgate gets wrong, the app still gets its whole answer.
 * The only error that may reach the caller is the model's own.
 */
const QUESTION = 'which postgres hosting should I use for a side project';

describe('adgateMiddleware never breaks a generation', () => {
  it('returns the whole answer with a suppress decision when evaluate fails', async () => {
    const { client, transport } = fakeClient({
      evaluate: () => Promise.reject(new Error('gateway unreachable')),
    });
    const decisions: EvaluateResult[] = [];
    const model = wrapGenerating(
      adgateMiddleware(client, {
        appId: 'app_x',
        getUser: () => ({ tier: 'free' }),
        onDecision: (decision) => decisions.push(decision),
      }),
    );

    const result = await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(result.content).toEqual([{ type: 'text', text: ANSWER }]);
    expect(adgateOf(result)?.decision).toMatchObject({
      decision: 'suppress',
      reason: 'error',
      creative: null,
      error: { kind: 'network' },
    });
    expect(adgateOf(result)?.audit_id).toBeNull();
    expect(decisions).toHaveLength(1);
    // audit_id is null: there is no record to attest against.
    expect(callsTo(transport.calls, ATTEST_PATH)).toHaveLength(0);
  });

  it('does not throw when attest fails', async () => {
    const { client, transport } = fakeClient({ attest: () => Promise.reject(new Error('down')) });
    const model = wrapGenerating(
      adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    );

    const result = await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(result.content).toEqual([{ type: 'text', text: ANSWER }]);
    expect(adgateOf(result)?.audit_id).toBe(AUDIT_ID);
    expect(await attestCalls(transport)).toHaveLength(1);
  });

  it('does not throw when the gateway rejects the attest', async () => {
    const { client } = fakeClient({ attest: () => emptyResponse(409) });
    const model = wrapGenerating(
      adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    );

    await expect(model.doGenerate(callParams(userPrompt(QUESTION)))).resolves.toBeDefined();
  });

  it('fails closed when getUser throws, without calling the gateway', async () => {
    const { client, transport } = fakeClient();
    const warnings: string[] = [];
    const model = wrapGenerating(
      adgateMiddleware(client, {
        appId: 'app_x',
        getUser: () => {
          throw new Error('no session');
        },
        logger: { warn: (message) => warnings.push(message) },
      }),
    );

    const result = await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(result.content).toEqual([{ type: 'text', text: ANSWER }]);
    expect(adgateOf(result)?.decision.reason).toBe('error');
    expect(transport.calls).toHaveLength(0);
    expect(warnings).toEqual(['adgate middleware failed']);
  });

  it('survives a throwing onDecision and a throwing id resolver', async () => {
    const { client, transport } = fakeClient();
    const model = wrapGenerating(
      adgateMiddleware(client, {
        appId: 'app_x',
        getUser: () => ({ tier: 'free' }),
        conversationId: () => {
          throw new Error('bad resolver');
        },
        turnId: () => '',
        onDecision: () => {
          throw new Error('bad callback');
        },
      }),
    );

    const result = await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(adgateOf(result)?.audit_id).toBe(AUDIT_ID);
    const body = bodyOf(callsTo(transport.calls, EVALUATE_PATH)[0]!);
    expect(body['conversation_id']).toMatch(/^adgate_/);
    expect(body['turn_id']).toMatch(/^adgate_.*_1$/);
  });

  it("lets the model's own failure reach the caller and attests nothing", async () => {
    const { client, transport } = fakeClient();
    const model = wrapLanguageModel({
      model: new MockLanguageModelV4({
        doGenerate: () => Promise.reject(new Error('provider is down')),
      }),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    await expect(model.doGenerate(callParams(userPrompt(QUESTION)))).rejects.toThrow(
      'provider is down',
    );
    expect(callsTo(transport.calls, ATTEST_PATH)).toHaveLength(0);
  });
});
