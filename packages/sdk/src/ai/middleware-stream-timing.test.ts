import { wrapLanguageModel } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { ATTEST_PATH, EVALUATE_PATH } from '../client.js';
import { hashModelOutput } from '../hash.js';
import { bodyOf, callsTo, emptyResponse, jsonResponse, SERVE_BODY } from '../test-support.js';
import type { AdgateClient, AttestResult, EvaluateResult } from '../types.js';
import { adgateMiddleware } from './middleware.js';
import { FLUSH_ATTEST_TIMEOUT_MS } from './stream-decorator.js';
import {
  callParams,
  collect,
  fakeClient,
  streamScript,
  TOOL_CALLS_FINISH_REASON,
  userPrompt,
  type StreamPart,
} from './test-support.js';

/**
 * What the stream costs the reader. Nothing adgate does may delay a token, and nothing adgate
 * waits for at the end may hold the response open past what the caller would tolerate.
 */
const QUESTION = 'which postgres hosting should I use for a side project';
const DELTAS = ['Managed ', 'Postgres ', 'is the boring choice.'];

const streamingModel = (parts: StreamPart[]) =>
  new MockLanguageModelV4({ doStream: { stream: convertArrayToReadableStream(parts) } });

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe('the stream is never buffered', () => {
  it('delivers a text delta before evaluate has answered', async () => {
    const gate = deferred<Response>();
    const { client, transport } = fakeClient({ evaluate: () => gate.promise });
    const model = wrapLanguageModel({
      model: streamingModel(streamScript(DELTAS)),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    const stream = (await model.doStream(callParams(userPrompt(QUESTION)))).stream;
    const reader = stream.getReader();
    const parts: StreamPart[] = [];
    // Read until the first delta arrives. Nothing has answered /v1/evaluate yet: if the
    // transform waited for the decision before passing chunks on, this would never finish.
    while (parts.filter((part) => part.type === 'text-delta').length === 0) {
      const { done, value } = await reader.read();
      expect(done).toBe(false);
      if (value !== undefined) {
        parts.push(value);
      }
    }

    expect(callsTo(transport.calls, EVALUATE_PATH)).toHaveLength(1);
    expect(callsTo(transport.calls, ATTEST_PATH)).toHaveLength(0);
    gate.resolve(jsonResponse(200, SERVE_BODY));
    reader.releaseLock();
    await collect(stream);
  });
});

describe('the flush wait is bounded', () => {
  it('closes the stream when a hand-rolled client never settles its attest', async () => {
    vi.useFakeTimers();
    try {
      let attests = 0;
      // Not the adgate client: it has its own deadline. This is what a hand-rolled one can do.
      const client: AdgateClient = {
        evaluate: () => Promise.resolve(structuredClone(SERVE_BODY as unknown) as EvaluateResult),
        attest: () => {
          attests += 1;
          return new Promise<AttestResult>(() => {});
        },
        track: () => Promise.resolve({ ok: true, status: 204 }),
      };
      const model = wrapLanguageModel({
        model: streamingModel(streamScript(DELTAS)),
        middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
      });

      const stream = (await model.doStream(callParams(userPrompt(QUESTION)))).stream;
      const collected = collect(stream);
      await vi.advanceTimersByTimeAsync(FLUSH_ATTEST_TIMEOUT_MS);

      expect(await collected).toHaveLength(streamScript(DELTAS).length);
      expect(attests).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not linger when the attest settles normally', async () => {
    vi.useFakeTimers();
    try {
      const { client, transport } = fakeClient({ attest: () => emptyResponse(204) });
      const model = wrapLanguageModel({
        model: streamingModel(streamScript(DELTAS)),
        middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
      });

      await collect((await model.doStream(callParams(userPrompt(QUESTION)))).stream);

      expect(callsTo(transport.calls, ATTEST_PATH)).toHaveLength(1);
      // No deadline timer is left behind to keep a Node process alive.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a cancelled stream', () => {
  it('attests nothing and drops the partial answer', async () => {
    const { client, transport } = fakeClient();
    const model = wrapLanguageModel({
      model: streamingModel(streamScript(DELTAS)),
      middleware: adgateMiddleware(client, { appId: 'app_x', getUser: () => ({ tier: 'free' }) }),
    });

    const stream = (await model.doStream(callParams(userPrompt(QUESTION)))).stream;
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel('the user navigated away');

    expect(callsTo(transport.calls, ATTEST_PATH)).toHaveLength(0);
  });
});

describe('a streamed tool-call step', () => {
  it('is not attested: its text is not the answer', async () => {
    const { client, transport } = fakeClient();
    const middleware = adgateMiddleware(client, {
      appId: 'app_x',
      getUser: () => ({ tier: 'free' }),
      conversationId: () => 'conv_s',
      turnId: () => 'turn_s',
    });
    const step = (parts: StreamPart[]) =>
      wrapLanguageModel({ model: streamingModel(parts), middleware });

    await collect(
      (
        await step(streamScript(['looking that up'], TOOL_CALLS_FINISH_REASON)).doStream(
          callParams(userPrompt(QUESTION)),
        )
      ).stream,
    );
    expect(callsTo(transport.calls, ATTEST_PATH)).toHaveLength(0);

    await collect(
      (await step(streamScript(DELTAS)).doStream(callParams(userPrompt(QUESTION)))).stream,
    );

    // One evaluate for the turn, one attest, over the final step's text only.
    expect(callsTo(transport.calls, EVALUATE_PATH)).toHaveLength(1);
    const attests = callsTo(transport.calls, ATTEST_PATH);
    expect(attests).toHaveLength(1);
    expect(bodyOf(attests[0]!)['model_output_hash']).toBe(await hashModelOutput(DELTAS.join('')));
  });
});
