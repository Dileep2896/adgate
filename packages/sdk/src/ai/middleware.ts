import type { LanguageModelMiddleware } from 'ai';

import { failClosedEvaluate } from '../client.js';
import { attestAnswer, startEvaluate } from '../generation.js';
import type {
  AdgateClient,
  EvaluateRequest,
  EvaluateResult,
  Logger,
  RenderedOption,
} from '../types.js';
import {
  ADGATE_METADATA_KEY,
  metadataOf,
  type AdgateCallParams,
  type GenerateResult,
} from './ai-types.js';
import { generatedText, latestUserText } from './messages.js';
import { decorateStream } from './stream-decorator.js';
import {
  createTurnStore,
  finishReasonOf,
  isTurnFinal,
  newConversationId,
  turnKey,
} from './turn.js';

/**
 * adgate as a Vercel AI SDK middleware:
 *
 *   const model = wrapLanguageModel({ model: openai('gpt-4o'), middleware: adgateMiddleware(client, opts) });
 *
 * evaluate starts BEFORE the model call is awaited, so asking whether a sponsored slot is allowed
 * costs the turn no latency, and the complete answer is attested afterwards (only its sha256
 * leaves the process, and in the generate path the attest is not even waited for). The model
 * output is never touched: the decision travels in `providerMetadata.adgate`, and the app renders
 * the slot itself, after the answer.
 *
 * PASS A REAL CONVERSATION ID. Without `options.conversationId` every call becomes its own
 * conversation, and a per-conversation frequency cap over a conversation that lasts one turn
 * never binds: caps effectively do not apply. The generated default exists so a first
 * integration works, not so it can ship.
 *
 * Nothing in here can break a generation. Every adgate-side failure is swallowed and the
 * untouched model result is returned; the only error that ever reaches the caller is the model's
 * own. The client logs its own evaluate/attest failures through the logger it was built with;
 * `options.logger` receives the middleware's own (a throwing getUser, an unexpected wrapper
 * failure) and is silent by default.
 *
 * Built and tested against ai 7.0.92 (LanguageModelMiddleware, provider spec v4). The part
 * shapes are read structurally in messages.ts, so a different major keeps working at runtime.
 */
export type { AdgateCallParams, AdgateProviderMetadata } from './ai-types.js';
export { ADGATE_METADATA_KEY };

/** Who the turn is for. The same shape as EvaluateRequest.user, never a duplicate of it. */
export type AdgateUser = EvaluateRequest['user'];

export type AdgateSurfaceType = EvaluateRequest['surface']['type'];

export type AdgateMiddlewareOptions = {
  /** The adgate app this model belongs to (app_...). */
  appId: string;
  /**
   * The end user of this turn. Called once per generation, may be async. A tier that the app's
   * policy does not serve (paid, by default) is suppressed by the gateway.
   */
  getUser: (params: AdgateCallParams) => AdgateUser | Promise<AdgateUser>;
  /** Where the answer is shown. Default 'chat'. */
  surface?: AdgateSurfaceType;
  /**
   * The app's conversation id for this call. Production apps MUST pass this. The default is a
   * fresh random id PER CALL, which means every turn looks like a brand new conversation to the
   * gateway: per-conversation frequency caps then never bind, and the conversation hash in the
   * audit record joins nothing. One middleware instance normally serves every conversation in
   * the process, so a per-instance id would be worse still (one cap bucket for all users).
   */
  conversationId?: (params: AdgateCallParams) => string;
  /**
   * The app's turn id. Default: the resolved conversation id plus a per-instance counter.
   * Together with the conversation id it also identifies a TURN across the several model calls
   * a tool-using generation makes: steps that resolve to the same pair share one evaluate, one
   * audit record and one attest.
   */
  turnId?: (params: AdgateCallParams) => string;
  /**
   * Called exactly once per turn, as soon as the gateway answers, in both the generate and the
   * stream path. This is the reliable way to get the decision while streaming: the finish part
   * carries it too, but only providers that pass provider metadata through will surface it.
   */
  onDecision?: (decision: EvaluateResult) => void;
  /**
   * Whether the sponsored block was actually shown, for the attest record. Default: true for a
   * serve, false for a suppress. A middleware sits in the model call and cannot know what the UI
   * did with the decision, so an app that CAN tell should pass a predicate here (or skip the
   * middleware's attest entirely and call client.attest itself once the slot has rendered).
   */
  rendered?: RenderedOption;
  /** Receives the middleware's own failures. Default: nothing is logged. */
  logger?: Logger;
};

const DEFAULT_SURFACE: AdgateSurfaceType = 'chat';

/** A logger is user code; it must never be able to break a generation. */
const safeWarn = (logger: Logger | undefined, message: string, data: Record<string, unknown>) => {
  if (logger === undefined) {
    return;
  }
  try {
    logger.warn(message, data);
  } catch {
    // Deliberately swallowed: a throwing logger is the caller's bug.
  }
};

export const adgateMiddleware = (
  client: AdgateClient,
  options: AdgateMiddlewareOptions,
): LanguageModelMiddleware => {
  const turns = createTurnStore();
  let counter = 0;

  const warn = (at: string): void => {
    safeWarn(options.logger, 'adgate middleware failed', { at });
  };

  const resolveId = (
    resolver: ((params: AdgateCallParams) => string) | undefined,
    params: AdgateCallParams,
    fallback: () => string,
  ): string => {
    if (resolver !== undefined) {
      try {
        const value = resolver(params);
        if (typeof value === 'string' && value.length > 0) {
          return value;
        }
      } catch {
        // A throwing or empty resolver is a caller bug; a generated id keeps the turn auditable.
      }
    }
    return fallback();
  };

  const resolveIds = (params: AdgateCallParams): { conversation: string; turn: string } => {
    const conversation = resolveId(options.conversationId, params, newConversationId);
    const turn = resolveId(options.turnId, params, () => `${conversation}_${(counter += 1)}`);
    return { conversation, turn };
  };

  const buildRequest = async (
    ids: { conversation: string; turn: string },
    params: AdgateCallParams,
  ): Promise<EvaluateRequest> => ({
    app_id: options.appId,
    conversation_id: ids.conversation,
    turn_id: ids.turn,
    user: await options.getUser(params),
    // Only the latest user message: the app's system prompt and any tool output stay out of the
    // gateway entirely, and the gateway stores hashes and categories, not this text.
    messages: [{ role: 'user', content: latestUserText(params.prompt) }],
    surface: {
      type: options.surface ?? DEFAULT_SURFACE,
      placement: 'after_answer',
      max_creatives: 1,
    },
  });

  const failClosed = (reason: string): EvaluateResult => {
    warn(reason);
    return failClosedEvaluate({ kind: 'network' }, 0);
  };

  const notify = (decision: EvaluateResult): void => {
    if (options.onDecision === undefined) {
      return;
    }
    try {
      options.onDecision(decision);
    } catch {
      warn('onDecision');
    }
  };

  /**
   * Starts evaluate immediately and reports the decision to onDecision exactly once. The returned
   * promise never rejects, so awaiting it later (after the answer is complete) is always safe.
   */
  const startTurn = (
    ids: { conversation: string; turn: string },
    params: AdgateCallParams,
  ): Promise<EvaluateResult> => {
    const signal = params.abortSignal;
    let evaluation: Promise<EvaluateResult>;
    try {
      evaluation = buildRequest(ids, params).then(
        (request) => startEvaluate(client, request, signal),
        () => failClosed('getUser'),
      );
    } catch {
      evaluation = Promise.resolve(failClosed('request'));
    }
    // Attached in the same tick: the caller's generation may reject first and abandon this
    // promise, and notify() cannot throw, so nothing here can become an unhandled rejection.
    void evaluation.then(notify);
    return evaluation;
  };

  /**
   * The evaluation for this turn: a new one for a turn's first step, the running one for every
   * later step of the same turn (a tool call loop reaches the middleware once per step).
   */
  const beginTurn = (
    params: AdgateCallParams,
  ): { key: string; evaluation: Promise<EvaluateResult> } => {
    const ids = resolveIds(params);
    const key = turnKey(ids.conversation, ids.turn);
    const running = turns.get(key);
    if (running !== undefined) {
      return { key, evaluation: running };
    }
    const evaluation = startTurn(ids, params);
    turns.set(key, evaluation);
    return { key, evaluation };
  };

  const attest = async (
    decision: EvaluateResult,
    text: string,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    try {
      await attestAnswer(client, decision, text, options.rendered, signal);
    } catch {
      warn('attest');
    }
  };

  const withDecision = (result: GenerateResult, decision: EvaluateResult): GenerateResult => ({
    ...result,
    providerMetadata: {
      ...result.providerMetadata,
      [ADGATE_METADATA_KEY]: metadataOf(decision),
    },
  });

  return {
    specificationVersion: 'v4',

    wrapGenerate: async ({ doGenerate, params }) => {
      const { key, evaluation } = beginTurn(params);
      // Awaited after evaluate is already in flight: the two overlap, adgate adds no latency.
      const result = await doGenerate();
      try {
        const decision = await evaluation;
        if (isTurnFinal(finishReasonOf(result.finishReason))) {
          turns.end(key);
          // NOT awaited: the answer must never wait for the audit write. attest() resolves for
          // every outcome, and the catch covers a hand-rolled client that rejects instead.
          void attest(decision, generatedText(result.content), params.abortSignal).catch(() => {});
        }
        return withDecision(result, decision);
      } catch {
        warn('generate');
        return result;
      }
    },

    wrapStream: async ({ doStream, params }) => {
      const { key, evaluation } = beginTurn(params);
      const result = await doStream();
      try {
        const decorated = decorateStream({
          evaluation,
          attest: (decision, text) => attest(decision, text, params.abortSignal),
          endTurn: () => {
            turns.end(key);
          },
          warn,
        });
        return { ...result, stream: result.stream.pipeThrough(decorated) };
      } catch {
        warn('stream');
        return result;
      }
    },
  };
};
