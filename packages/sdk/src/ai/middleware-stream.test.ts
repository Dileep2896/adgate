import { streamText, wrapLanguageModel } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { ATTEST_PATH } from '../client.js';
import { hashModelOutput } from '../hash.js';
import { AUDIT_ID, bodyOf, callsTo, SERVE_BODY } from '../test-support.js';
import type { EvaluateResult } from '../types.js';
import { ADGATE_METADATA_KEY, adgateMiddleware } from './middleware.js';
import {
  adgateMetadataOf as adgateOf,
  callParams,
  collect,
  fakeClient,
  FINISH_REASON,
  streamScript,
  USAGE,
  userPrompt,
  type StreamPart,
} from './test-support.js';

/**
 * The stream path. Every chunk must reach the consumer exactly as the provider emitted it; the
 * only addition is the decision on the terminal finish part, and the answer is attested once
 * when the stream ends.
 */
const QUESTION = 'which postgres hosting should I use for a side project';
const DELTAS = ['Managed ', 'Postgres ', 'is the boring choice.'];
const ANSWER = DELTAS.join('');

const streamingModel = (parts: StreamPart[]) =>
  new MockLanguageModelV4({ doStream: { stream: convertArrayToReadableStream(parts) } });

describe('adgateMiddleware stream path', () => {
  it('passes every chunk through unchanged and only adds the decision to finish', async () => {
    const script = streamScript(DELTAS);
    const { client } = fakeClient();
    const model = wrapLanguageModel({
      model: streamingModel(script),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    const parts = await collect((await model.doStream(callParams(userPrompt(QUESTION)))).stream);

    expect(parts).toHaveLength(script.length);
    expect(parts.slice(0, -1)).toEqual(script.slice(0, -1));
    // The finish part is the script's, plus the decision under providerMetadata.
    expect(parts.at(-1)).toEqual({
      type: 'finish',
      usage: USAGE,
      finishReason: FINISH_REASON,
      providerMetadata: { [ADGATE_METADATA_KEY]: { decision: SERVE_BODY, audit_id: AUDIT_ID } },
    });
  });

  it('attests once with the sha256 of the joined deltas', async () => {
    const { client, transport } = fakeClient();
    const model = wrapLanguageModel({
      model: streamingModel(streamScript(DELTAS)),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    await collect((await model.doStream(callParams(userPrompt(QUESTION)))).stream);

    const attests = callsTo(transport.calls, ATTEST_PATH);
    expect(attests).toHaveLength(1);
    expect(bodyOf(attests[0]!)).toEqual({
      audit_id: AUDIT_ID,
      model_output_hash: await hashModelOutput(ANSWER),
      rendered: true,
    });
    expect(attests[0]!.init.body).not.toContain('Postgres');
  });

  it('calls onDecision exactly once', async () => {
    const { client } = fakeClient();
    const decisions: EvaluateResult[] = [];
    const model = wrapLanguageModel({
      model: streamingModel(streamScript(DELTAS)),
      middleware: adgateMiddleware(client, {
        appId: 'app_x',
        getUser: () => ({ tier: 'free' }),
        onDecision: (decision) => decisions.push(decision),
      }),
    });

    await collect((await model.doStream(callParams(userPrompt(QUESTION)))).stream);

    expect(decisions).toEqual([SERVE_BODY]);
  });

  it('attests even when the provider emits no finish part', async () => {
    const script = streamScript(DELTAS).filter((part) => part.type !== 'finish');
    const { client, transport } = fakeClient();
    const model = wrapLanguageModel({
      model: streamingModel(script),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    const parts = await collect((await model.doStream(callParams(userPrompt(QUESTION)))).stream);

    expect(parts).toEqual(script);
    expect(bodyOf(callsTo(transport.calls, ATTEST_PATH)[0]!)['model_output_hash']).toBe(
      await hashModelOutput(ANSWER),
    );
  });

  it('streams the whole answer with a suppress decision when evaluate fails', async () => {
    const script = streamScript(DELTAS);
    const decisions: EvaluateResult[] = [];
    const { client, transport } = fakeClient({
      evaluate: () => Promise.reject(new Error('gateway unreachable')),
    });
    const model = wrapLanguageModel({
      model: streamingModel(script),
      middleware: adgateMiddleware(client, {
        appId: 'app_x',
        getUser: () => ({ tier: 'free' }),
        onDecision: (decision) => decisions.push(decision),
      }),
    });

    const parts = await collect((await model.doStream(callParams(userPrompt(QUESTION)))).stream);

    expect(parts.slice(0, -1)).toEqual(script.slice(0, -1));
    expect(adgateOf(parts.at(-1)!)?.decision).toMatchObject({
      decision: 'suppress',
      reason: 'error',
      error: { kind: 'network' },
    });
    expect(decisions).toHaveLength(1);
    expect(callsTo(transport.calls, ATTEST_PATH)).toHaveLength(0);
  });

  it('does not break the stream when attest fails', async () => {
    const script = streamScript(DELTAS);
    const { client, transport } = fakeClient({ attest: () => Promise.reject(new Error('down')) });
    const model = wrapLanguageModel({
      model: streamingModel(script),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    const parts = await collect((await model.doStream(callParams(userPrompt(QUESTION)))).stream);

    expect(parts).toHaveLength(script.length);
    expect(callsTo(transport.calls, ATTEST_PATH)).toHaveLength(1);
  });

  it("lets the model's own failure reach the caller and attests nothing", async () => {
    const { client, transport } = fakeClient();
    const model = wrapLanguageModel({
      model: new MockLanguageModelV4({
        doStream: () => Promise.reject(new Error('provider is down')),
      }),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    await expect(model.doStream(callParams(userPrompt(QUESTION)))).rejects.toThrow(
      'provider is down',
    );
    expect(callsTo(transport.calls, ATTEST_PATH)).toHaveLength(0);
  });

  it('works through streamText, the API an app actually calls', async () => {
    const { client, transport } = fakeClient();
    const decisions: EvaluateResult[] = [];
    const result = streamText({
      model: wrapLanguageModel({
        model: streamingModel(streamScript(DELTAS)),
        middleware: adgateMiddleware(client, {
          appId: 'app_x',
          getUser: () => ({ tier: 'free' }),
          onDecision: (decision) => decisions.push(decision),
        }),
      }),
      prompt: QUESTION,
    });

    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe(ANSWER);
    expect(decisions).toEqual([SERVE_BODY]);
    expect(bodyOf(callsTo(transport.calls, ATTEST_PATH)[0]!)['model_output_hash']).toBe(
      await hashModelOutput(ANSWER),
    );
  });
});
