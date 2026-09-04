import { generateText, wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { EVALUATE_PATH } from '../client.js';
import { hashModelOutput } from '../hash.js';
import {
  AUDIT_ID,
  bodyOf,
  callsTo,
  jsonResponse,
  SERVE_BODY,
  SUPPRESS_BODY,
} from '../test-support.js';
import type { EvaluateResult } from '../types.js';
import { adgateMiddleware } from './middleware.js';
import {
  adgateMetadataOf as adgateOf,
  ANSWER,
  attestCalls,
  callParams,
  fakeClient,
  generateResult,
  userPrompt,
  wrapGenerating as wrap,
} from './test-support.js';

/**
 * The generate path, driven through the real `wrapLanguageModel` with the AI SDK's own fake
 * model. Nothing here touches the network: the gateway is a routed fake fetch.
 */
const QUESTION = 'which postgres hosting should I use for a side project';

describe('adgateMiddleware generate path', () => {
  it('attaches the decision to providerMetadata without touching the answer', async () => {
    const { client, transport } = fakeClient();
    const model = wrap(
      adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    );

    const result = await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(result.content).toEqual([{ type: 'text', text: ANSWER }]);
    expect(adgateOf(result)).toEqual({ decision: SERVE_BODY, audit_id: AUDIT_ID });
    await attestCalls(transport);
    expect(transport.calls).toHaveLength(2);
  });

  it('keeps provider metadata the model already set', async () => {
    const { client } = fakeClient();
    const model = wrapLanguageModel({
      model: new MockLanguageModelV4({
        doGenerate: { ...generateResult([ANSWER]), providerMetadata: { openai: { cached: true } } },
      }),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    const result = await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(result.providerMetadata?.['openai']).toEqual({ cached: true });
    expect(adgateOf(result)?.audit_id).toBe(AUDIT_ID);
  });

  it('evaluates the turn before the model answers, so the two overlap', async () => {
    const { client, transport } = fakeClient();
    let evaluatedBeforeGenerate = false;
    const model = wrapLanguageModel({
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          await vi.waitFor(() => expect(callsTo(transport.calls, EVALUATE_PATH)).toHaveLength(1));
          evaluatedBeforeGenerate = true;
          return generateResult([ANSWER]);
        },
      }),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(evaluatedBeforeGenerate).toBe(true);
  });

  it('sends the turn the way docs/api.md describes it', async () => {
    const { client, transport } = fakeClient();
    const model = wrap(
      adgateMiddleware(client, {
        appId: 'app_01J0000000000000000000TEST',
        getUser: () => ({ tier: 'paid', region: 'US', locale: 'en-US' }),
        surface: 'cli',
        conversationId: () => 'conv_42',
        turnId: () => 'turn_7',
      }),
    );

    await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(bodyOf(callsTo(transport.calls, EVALUATE_PATH)[0]!)).toEqual({
      app_id: 'app_01J0000000000000000000TEST',
      conversation_id: 'conv_42',
      turn_id: 'turn_7',
      user: { tier: 'paid', region: 'US', locale: 'en-US' },
      messages: [{ role: 'user', content: QUESTION }],
      surface: { type: 'cli', placement: 'after_answer', max_creatives: 1 },
    });
  });

  it('classifies only the last user message: no system prompt, no tool output', async () => {
    const { client, transport } = fakeClient();
    const model = wrap(
      adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    );

    await model.doGenerate(
      callParams([
        { role: 'system', content: 'You are a helpful assistant with a secret system prompt.' },
        { role: 'user', content: [{ type: 'text', text: 'an earlier question' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'search', input: '{}' }],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'search',
              output: { type: 'text', value: 'tool output that must not be classified' },
            },
          ],
        },
        { role: 'user', content: [{ type: 'text', text: QUESTION }] },
      ]),
    );

    const body = bodyOf(callsTo(transport.calls, EVALUATE_PATH)[0]!);
    expect(body['messages']).toEqual([{ role: 'user', content: QUESTION }]);
    expect(JSON.stringify(body)).not.toContain('secret system prompt');
    expect(JSON.stringify(body)).not.toContain('tool output');
    expect(JSON.stringify(body)).not.toContain('earlier question');
  });

  it('attests once with the sha256 of the full answer, and sends no text', async () => {
    const { client, transport } = fakeClient();
    const model = wrap(
      adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
      ['Managed Postgres', ' is the boring choice.'],
    );

    await model.doGenerate(callParams(userPrompt(QUESTION)));

    const attests = await attestCalls(transport);
    expect(bodyOf(attests[0]!)).toEqual({
      audit_id: AUDIT_ID,
      model_output_hash: await hashModelOutput('Managed Postgres is the boring choice.'),
      rendered: true,
    });
    expect(attests[0]!.init.body).not.toContain('Managed Postgres');
  });

  it('reports rendered false when the gateway suppressed the slot', async () => {
    const { client, transport } = fakeClient({ evaluate: () => jsonResponse(200, SUPPRESS_BODY) });
    const model = wrap(
      adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'paid' }) }),
    );

    const result = await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(adgateOf(result)?.decision.decision).toBe('suppress');
    expect(bodyOf((await attestCalls(transport))[0]!)['rendered']).toBe(false);
  });

  it('calls onDecision exactly once', async () => {
    const { client } = fakeClient();
    const decisions: EvaluateResult[] = [];
    const model = wrap(
      adgateMiddleware(client, {
        appId: 'app_x',
        getUser: () => ({ tier: 'free' }),
        onDecision: (decision) => decisions.push(decision),
      }),
    );

    await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(decisions).toEqual([SERVE_BODY]);
  });

  it('works through generateText, the API an app actually calls', async () => {
    const { client, transport } = fakeClient();
    const result = await generateText({
      model: wrap(adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) })),
      prompt: QUESTION,
    });

    expect(result.text).toBe(ANSWER);
    expect(adgateOf(result)?.audit_id).toBe(AUDIT_ID);
    expect(bodyOf(callsTo(transport.calls, EVALUATE_PATH)[0]!)['messages']).toEqual([
      { role: 'user', content: QUESTION },
    ]);
  });
});
