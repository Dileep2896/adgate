import type { LanguageModelMiddleware } from 'ai';

import { failClosedEvaluate } from '../client.js';
import { attestAnswer, startEvaluate } from '../generation.js';
import type { AdgateClient, EvaluateRequest, EvaluateResult, Logger } from '../types.js';
import { generatedText, isFinishPart, latestUserText, textDeltaOf } from './messages.js';

/**
 * adgate as a Vercel AI SDK middleware:
 *
 *   const model = wrapLanguageModel({ model: openai('gpt-4o'), middleware: adgateMiddleware(client, opts) });
 *
 * evaluate starts BEFORE the model call is awaited, so asking whether a sponsored slot is allowed
 * costs the turn no latency, and the complete answer is attested afterwards (only its sha256
 * leaves the process). The model output is never touched: the decision travels in
 * `providerMetadata.adgate`, and the app renders the slot itself, after the answer.
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
type WrapGenerate = NonNullable<LanguageModelMiddleware['wrapGenerate']>;
type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>;
type GenerateResult = Awaited<ReturnType<WrapGenerate>>;
type StreamResult = Awaited<ReturnType<WrapStream>>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;
type ProviderMetadata = NonNullable<GenerateResult['providerMetadata']>;
type ProviderMetadataValue = ProviderMetadata[string];

/** The call options the AI SDK hands the middleware: prompt, abortSignal, settings, tools. */
export type AdgateCallParams = Parameters<WrapGenerate>[0]['params'];

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
   * The app's conversation id for this call. Default: one stable id per adgateMiddleware()
   * instance. Real apps should pass their own, because one middleware instance is usually shared
   * by every conversation the process serves, and frequency caps are per conversation.
   */
  conversationId?: (params: AdgateCallParams) => string;
  /** The app's turn id. Default: the conversation id plus a per-instance counter. */
  turnId?: (params: AdgateCallParams) => string;
  /**
   * Called exactly once per generation, as soon as the gateway answers, in both the generate and
   * the stream path. This is the reliable way to get the decision while streaming: the finish
   * part carries it too, but only providers that pass provider metadata through will surface it.
   */
  onDecision?: (decision: EvaluateResult) => void;
  /** Receives the middleware's own failures. Default: nothing is logged. */
  logger?: Logger;
};

/** What is attached to the result under `providerMetadata.adgate`. */
export type AdgateProviderMetadata = {
  decision: EvaluateResult;
  /** The audit record this turn was written to, or null when evaluate never reached the gateway. */
  audit_id: string | null;
};

export const ADGATE_METADATA_KEY = 'adgate';

const DEFAULT_SURFACE: AdgateSurfaceType = 'chat';

/** Stable for the life of one adgateMiddleware() instance. Apps should pass their own ids. */
const newConversationId = (): string =>
  `adgate_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

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

/** The decision, shaped for provider metadata. It is JSON: it came from the gateway as JSON. */
const metadataOf = (decision: EvaluateResult): ProviderMetadataValue => {
  const metadata: AdgateProviderMetadata = { decision, audit_id: decision.audit_id };
  return metadata as unknown as ProviderMetadataValue;
};

export const adgateMiddleware = (
  client: AdgateClient,
  options: AdgateMiddlewareOptions,
): LanguageModelMiddleware => {
  const conversationId = newConversationId();
  let turn = 0;

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

  const buildRequest = async (params: AdgateCallParams): Promise<EvaluateRequest> => ({
    app_id: options.appId,
    conversation_id: resolveId(options.conversationId, params, () => conversationId),
    turn_id: resolveId(options.turnId, params, () => `${conversationId}_${(turn += 1)}`),
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
    safeWarn(options.logger, 'adgate middleware failed', { at: reason });
    return failClosedEvaluate({ kind: 'network' }, 0);
  };

  const notify = (decision: EvaluateResult): void => {
    if (options.onDecision === undefined) {
      return;
    }
    try {
      options.onDecision(decision);
    } catch {
      safeWarn(options.logger, 'adgate middleware failed', { at: 'onDecision' });
    }
  };

  /**
   * Starts evaluate immediately and reports the decision to onDecision exactly once. The returned
   * promise never rejects, so awaiting it later (after the answer is complete) is always safe.
   */
  const beginTurn = (params: AdgateCallParams): Promise<EvaluateResult> => {
    const signal = params.abortSignal;
    let evaluation: Promise<EvaluateResult>;
    try {
      evaluation = buildRequest(params).then(
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

  const attest = async (
    decision: EvaluateResult,
    text: string,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    try {
      await attestAnswer(client, decision, text, undefined, signal);
    } catch {
      safeWarn(options.logger, 'adgate middleware failed', { at: 'attest' });
    }
  };

  const withDecision = (result: GenerateResult, decision: EvaluateResult): GenerateResult => ({
    ...result,
    providerMetadata: {
      ...result.providerMetadata,
      [ADGATE_METADATA_KEY]: metadataOf(decision),
    },
  });

  const finishWithDecision = (part: StreamPart, decision: EvaluateResult): StreamPart => {
    const existing = (part as { providerMetadata?: ProviderMetadata }).providerMetadata;
    return {
      ...part,
      providerMetadata: { ...existing, [ADGATE_METADATA_KEY]: metadataOf(decision) },
    } as StreamPart;
  };

  /**
   * Passes every chunk through untouched, accumulating the text deltas so the finished answer can
   * be attested. Only the terminal `finish` part waits, and only for the decision (bounded by the
   * client's own deadline): every token has already reached the caller by then. The attest is
   * awaited in flush, so the request is issued before the stream closes and cannot be cut off by
   * a serverless runtime that freezes after the response.
   */
  const decorate = (
    evaluation: Promise<EvaluateResult>,
    signal: AbortSignal | undefined,
  ): TransformStream<StreamPart, StreamPart> => {
    let answer = '';
    return new TransformStream<StreamPart, StreamPart>({
      transform: async (part, controller) => {
        // Exactly one enqueue per incoming part, whatever happens above it.
        let outgoing = part;
        try {
          const delta = textDeltaOf(part);
          if (delta !== null) {
            answer += delta;
          } else if (isFinishPart(part)) {
            outgoing = finishWithDecision(part, await evaluation);
          }
        } catch {
          safeWarn(options.logger, 'adgate middleware failed', { at: 'stream' });
        }
        controller.enqueue(outgoing);
      },
      flush: async () => {
        try {
          const decision = await evaluation;
          const text = answer;
          answer = '';
          await attest(decision, text, signal);
        } catch {
          safeWarn(options.logger, 'adgate middleware failed', { at: 'finish' });
        }
      },
    });
  };

  return {
    specificationVersion: 'v4',

    wrapGenerate: async ({ doGenerate, params }) => {
      const evaluation = beginTurn(params);
      // Awaited after evaluate is already in flight: the two overlap, adgate adds no latency.
      const result = await doGenerate();
      try {
        const decision = await evaluation;
        await attest(decision, generatedText(result.content), params.abortSignal);
        return withDecision(result, decision);
      } catch {
        safeWarn(options.logger, 'adgate middleware failed', { at: 'generate' });
        return result;
      }
    },

    wrapStream: async ({ doStream, params }) => {
      const evaluation = beginTurn(params);
      const result = await doStream();
      try {
        return {
          ...result,
          stream: result.stream.pipeThrough(decorate(evaluation, params.abortSignal)),
        };
      } catch {
        safeWarn(options.logger, 'adgate middleware failed', { at: 'stream' });
        return result;
      }
    },
  };
};
