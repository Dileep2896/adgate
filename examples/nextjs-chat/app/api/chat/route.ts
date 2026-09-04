import { adgateMiddleware } from '@adgate/sdk/ai';
import type { EvaluateResult } from '@adgate/sdk';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  wrapLanguageModel,
} from 'ai';

import { adgateAppId, adgateClient } from '@/lib/adgate';
import {
  ADGATE_DATA_PART_TYPE,
  isTier,
  type ChatMessage,
  type ChatRequestBody,
  type Tier,
} from '@/lib/chat';
import { withDecisionTimeout } from '@/lib/decision';
import { selectModel } from '@/lib/model';

/**
 * The whole adgate integration for a chat app is in this file.
 *
 * 1. `adgateMiddleware` wraps the language model. It calls POST /v1/evaluate as soon as the
 *    generation starts (in parallel with the model, so it costs the turn no latency), and
 *    attests the finished answer's sha256 afterwards. It never touches the model's text.
 * 2. The decision reaches the browser as its own `data-adgate` part on the same stream, written
 *    after the last text chunk and before the stream's `finish` chunk. It is NEVER concatenated
 *    into the answer: an ad inside model output is exactly what adgate exists to prevent.
 * 3. components/assistant-turn.tsx renders <SponsoredSlot> from that data part, outside the
 *    assistant message container.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const SYSTEM_PROMPT = 'You are a concise engineering assistant. Answer in at most four sentences.';

const tierOf = (body: ChatRequestBody): Tier => (isTier(body.tier) ? body.tier : 'free');

/** One turn per user message: its id is stable across retries and identifies the audit record. */
const turnIdOf = (messages: readonly ChatMessage[]): string => {
  const last = messages[messages.length - 1];
  return last === undefined ? `turn_${Date.now()}` : `turn_${last.id}`;
};

export const POST = async (request: Request): Promise<Response> => {
  const body = (await request.json()) as ChatRequestBody;
  const messages = body.messages ?? [];
  // useChat sends its chat id, which is exactly the conversation the frequency caps apply to.
  const conversationId = body.id ?? `conv_${crypto.randomUUID()}`;
  const turnId = turnIdOf(messages);
  const tier = tierOf(body);
  const { model } = selectModel();

  let announce: (decision: EvaluateResult) => void = () => {};
  const decision = new Promise<EvaluateResult>((resolve) => {
    announce = resolve;
  });

  const guarded = wrapLanguageModel({
    model,
    middleware: adgateMiddleware(adgateClient(), {
      appId: adgateAppId(),
      surface: 'chat',
      // The gateway decides on the tier: `paid` is suppressed unless the app's policy sets
      // allow_paid_tiers. The UI toggle is what makes that visible in this example.
      getUser: () => ({ tier, region: 'US', locale: 'en-US' }),
      conversationId: () => conversationId,
      turnId: () => turnId,
      onDecision: (result) => {
        announce(result);
      },
      logger: {
        warn: (message, data) => {
          console.warn(`[adgate] ${message}`, data ?? {});
        },
      },
    }),
  });

  const stream = createUIMessageStream<ChatMessage>({
    execute: async ({ writer }) => {
      const result = streamText({
        model: guarded,
        system: SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages),
        abortSignal: request.signal,
      });
      const reader = result.toUIMessageStream<ChatMessage>().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value.type === 'finish') {
          // The answer is complete: hand the UI the decision as a separate part, then let the
          // model's own finish chunk through unchanged.
          writer.write({
            type: ADGATE_DATA_PART_TYPE,
            id: turnId,
            data: await withDecisionTimeout(decision),
          });
        }
        writer.write(value);
      }
    },
    onError: () => 'The model call failed.',
  });

  return createUIMessageStreamResponse({ stream });
};
