import type { EvaluateResult } from '../types.js';
import {
  ADGATE_METADATA_KEY,
  metadataOf,
  type ProviderMetadata,
  type StreamPart,
} from './ai-types.js';
import { isFinishPart, textDeltaOf } from './messages.js';
import { finishReasonOf, isTurnFinal } from './turn.js';

/**
 * The transform the middleware pipes a streamed generation through. It exists as its own file
 * only so middleware.ts stays readable; everything it needs is passed in.
 */
export type StreamDecoratorContext = {
  /** Never rejects (the middleware guarantees it), so awaiting it in flush is always safe. */
  evaluation: Promise<EvaluateResult>;
  /** Sends the attest for the finished answer. Never rejects. */
  attest: (decision: EvaluateResult, text: string) => Promise<void>;
  /** Called when the last step of the turn has been seen, before the attest. */
  endTurn: () => void;
  warn: (at: string) => void;
};

/**
 * How long flush waits for the attest before letting the stream close. The client has its own
 * deadline (800 ms by default) and settles well inside this, so in practice the race never
 * fires; it only stops a hand-rolled client that never settles from holding the response open.
 */
export const FLUSH_ATTEST_TIMEOUT_MS = 2_000;

const withDeadline = async (work: Promise<void>, ms: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Passes every chunk through untouched, accumulating the text deltas so the finished answer can
 * be attested. Only the terminal `finish` part waits, and only for the decision (bounded by the
 * client's own deadline): every token has already reached the caller by then.
 *
 * The attest IS awaited here, unlike in the generate path, because flush runs while the response
 * is still open: a serverless runtime that freezes the moment the stream closes would otherwise
 * drop the request. The wait is bounded so that a client which never settles cannot hold the
 * stream open for longer than the caller would tolerate.
 */
/**
 * `cancel` reached the Streams spec after the TypeScript DOM lib froze its Transformer type;
 * Node 20 and every current browser call it, older runtimes simply never do.
 */
type CancellableTransformer = Transformer<StreamPart, StreamPart> & {
  cancel?: (reason?: unknown) => void;
};

export const decorateStream = (
  context: StreamDecoratorContext,
): TransformStream<StreamPart, StreamPart> => {
  let answer = '';
  // No finish part at all (some providers emit none) counts as the end of the turn.
  let final = true;

  const finishWithDecision = (part: StreamPart, decision: EvaluateResult): StreamPart => {
    const existing = (part as { providerMetadata?: ProviderMetadata }).providerMetadata;
    return {
      ...part,
      providerMetadata: { ...existing, [ADGATE_METADATA_KEY]: metadataOf(decision) },
    } as StreamPart;
  };

  const transformer: CancellableTransformer = {
    transform: async (part, controller) => {
      // Exactly one enqueue per incoming part, whatever happens above it.
      let outgoing = part;
      try {
        const delta = textDeltaOf(part);
        if (delta !== null) {
          answer += delta;
        } else if (isFinishPart(part)) {
          final = isTurnFinal(finishReasonOf((part as { finishReason?: unknown }).finishReason));
          outgoing = finishWithDecision(part, await context.evaluation);
        }
      } catch {
        context.warn('stream');
      }
      controller.enqueue(outgoing);
    },
    flush: async () => {
      try {
        const decision = await context.evaluation;
        const text = answer;
        answer = '';
        if (!final) {
          // A tool-call step: the SDK will call the model again, and the next step's text is
          // the answer. Attesting this one would record a fragment.
          return;
        }
        context.endTurn();
        await withDeadline(context.attest(decision, text), FLUSH_ATTEST_TIMEOUT_MS);
      } catch {
        context.warn('finish');
      }
    },
    cancel: () => {
      // The consumer walked away mid-answer: flush never runs, so there is nothing to attest,
      // and the partial answer must not sit in this closure waiting for the GC.
      answer = '';
    },
  };
  return new TransformStream<StreamPart, StreamPart>(transformer);
};
