import { wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { EVALUATE_PATH } from '../client.js';
import { hashModelOutput } from '../hash.js';
import { AUDIT_ID, bodyOf, callsTo } from '../test-support.js';
import { adgateMiddleware } from './middleware.js';
import {
  adgateMetadataOf as adgateOf,
  ANSWER,
  attestCalls,
  callParams,
  fakeClient,
  generateResult,
  TOOL_CALLS_FINISH_REASON,
  userPrompt,
  wrapGenerating as wrap,
} from './test-support.js';

/**
 * Which turn a model call belongs to, and what that costs the answer. One middleware instance is
 * normally module scope: it is shared by every conversation the process serves, and it may be
 * called several times for ONE question when the model uses tools.
 */
const QUESTION = 'which postgres hosting should I use for a side project';
const OPTIONS = { appId: 'app_x', getUser: () => ({ tier: 'free' as const }) };

describe('conversation and turn ids', () => {
  it('generates a fresh conversation id per call, not per middleware instance', async () => {
    const { client, transport } = fakeClient();
    const model = wrap(adgateMiddleware(client, OPTIONS));

    await model.doGenerate(callParams(userPrompt(QUESTION)));
    await model.doGenerate(callParams(userPrompt(QUESTION)));

    const [first, second] = callsTo(transport.calls, EVALUATE_PATH).map(
      (call) => bodyOf(call)['conversation_id'],
    );
    // A shared id would put every user of the process in one frequency-cap bucket and under one
    // conversation hash in the audit records.
    expect(first).toMatch(/^adgate_/);
    expect(second).toMatch(/^adgate_/);
    expect(first).not.toBe(second);
  });

  it('builds the default turn id from the RESOLVED conversation id', async () => {
    const { client, transport } = fakeClient();
    const model = wrap(
      adgateMiddleware(client, { ...OPTIONS, conversationId: () => 'conv_from_the_app' }),
    );

    await model.doGenerate(callParams(userPrompt(QUESTION)));
    await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(callsTo(transport.calls, EVALUATE_PATH).map((call) => bodyOf(call)['turn_id'])).toEqual([
      'conv_from_the_app_1',
      'conv_from_the_app_2',
    ]);
  });
});

describe('the generate path does not wait for the attest', () => {
  it('returns the answer while the attest is still in flight', async () => {
    vi.useFakeTimers();
    try {
      // Never settles and ignores its abort signal, so nothing but the code under test can
      // unblock the answer: awaiting this attest would hang the generation for good.
      const { client } = fakeClient({ attest: () => new Promise(() => {}) });
      const model = wrap(adgateMiddleware(client, OPTIONS));

      const result = await model.doGenerate(callParams(userPrompt(QUESTION)));

      expect(result.content).toEqual([{ type: 'text', text: ANSWER }]);
      expect(adgateOf(result)?.audit_id).toBe(AUDIT_ID);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the rendered option', () => {
  it('defaults to true for a serve, because the app was told to render the slot', async () => {
    const { client, transport } = fakeClient();
    const model = wrap(adgateMiddleware(client, OPTIONS));

    await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(bodyOf((await attestCalls(transport))[0]!)['rendered']).toBe(true);
  });

  it('takes a flat override from an app that knows the slot was not shown', async () => {
    const { client, transport } = fakeClient();
    const model = wrap(adgateMiddleware(client, { ...OPTIONS, rendered: false }));

    await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(bodyOf((await attestCalls(transport))[0]!)['rendered']).toBe(false);
  });

  it('takes a predicate, which is given the decision', async () => {
    const { client, transport } = fakeClient();
    const seen: string[] = [];
    const model = wrap(
      adgateMiddleware(client, {
        ...OPTIONS,
        rendered: (decision) => {
          seen.push(decision.decision);
          return false;
        },
      }),
    );

    await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(seen).toEqual(['serve']);
    expect(bodyOf((await attestCalls(transport))[0]!)['rendered']).toBe(false);
  });
});

describe('a multi-step tool run is ONE turn', () => {
  const PARTIAL = 'let me look that up';
  const FINAL = 'Managed Postgres with a free tier is the boring choice.';

  const twoStepModel = (client: ReturnType<typeof fakeClient>['client']) => {
    const steps = [generateResult([PARTIAL], TOOL_CALLS_FINISH_REASON), generateResult([FINAL])];
    return wrapLanguageModel({
      model: new MockLanguageModelV4({ doGenerate: () => Promise.resolve(steps.shift()!) }),
      middleware: adgateMiddleware(client, {
        ...OPTIONS,
        conversationId: () => 'conv_1',
        turnId: () => 'turn_1',
      }),
    });
  };

  it('evaluates once, attests once, and attests the FINAL step', async () => {
    const { client, transport } = fakeClient();
    const model = twoStepModel(client);

    const first = await model.doGenerate(callParams(userPrompt(QUESTION)));
    const second = await model.doGenerate(callParams(userPrompt(QUESTION)));

    // One cap slot, one audit record, one decision for the whole question.
    expect(callsTo(transport.calls, EVALUATE_PATH)).toHaveLength(1);
    expect(adgateOf(first)?.audit_id).toBe(AUDIT_ID);
    expect(adgateOf(second)?.audit_id).toBe(AUDIT_ID);

    const attests = await attestCalls(transport);
    expect(bodyOf(attests[0]!)['model_output_hash']).toBe(await hashModelOutput(FINAL));
    expect(attests[0]!.init.body).not.toContain(PARTIAL);
  });

  it('calls onDecision once for the whole turn', async () => {
    const { client } = fakeClient();
    let calls = 0;
    const steps = [generateResult([PARTIAL], TOOL_CALLS_FINISH_REASON), generateResult([FINAL])];
    const model = wrapLanguageModel({
      model: new MockLanguageModelV4({ doGenerate: () => Promise.resolve(steps.shift()!) }),
      middleware: adgateMiddleware(client, {
        ...OPTIONS,
        conversationId: () => 'conv_2',
        turnId: () => 'turn_2',
        onDecision: () => {
          calls += 1;
        },
      }),
    });

    await model.doGenerate(callParams(userPrompt(QUESTION)));
    await model.doGenerate(callParams(userPrompt(QUESTION)));

    expect(calls).toBe(1);
  });

  it('starts a new turn once the previous one finished', async () => {
    const { client, transport } = fakeClient();
    const model = wrap(
      adgateMiddleware(client, {
        ...OPTIONS,
        conversationId: () => 'conv_3',
        turnId: () => 'turn_3',
      }),
    );

    await model.doGenerate(callParams(userPrompt(QUESTION)));
    await attestCalls(transport, 1);
    await model.doGenerate(callParams(userPrompt(QUESTION)));

    // Same ids, but the first turn ended with finishReason 'stop': the second call is a new turn.
    expect(callsTo(transport.calls, EVALUATE_PATH)).toHaveLength(2);
  });
});
