import { attestAnswer, startEvaluate } from './generation.js';
import type {
  AdgateClient,
  EvaluateRequest,
  StreamFinishOptions,
  StreamHandle,
  StreamOptions,
  StreamResult,
} from './types.js';

/**
 * forStream is withGeneration for apps that stream the answer token by token: evaluate starts
 * immediately (its promise is exposed so the UI can reserve the slot while the answer is still
 * arriving), the chunks are accumulated locally, and finish() hashes the complete text and
 * attests once. Only the hash is ever sent, so the accumulated text never leaves the process.
 *
 * Chunks are strings. A caller streaming bytes decodes them first with a single streaming
 * TextDecoder (`decoder.decode(bytes, { stream: true })`): hashing chunks that split a
 * multi-byte character would not match the text the user saw.
 */
export const forStream = (
  client: AdgateClient,
  request: EvaluateRequest,
  options?: StreamOptions,
): StreamHandle => {
  const decisionPromise = startEvaluate(client, request, options?.signal);

  let chunks: string[] = [];
  let aborted = false;
  let finished: Promise<StreamResult> | null = null;

  const run = async (finishOptions: StreamFinishOptions | undefined): Promise<StreamResult> => {
    // Join once, then release the buffer: from here on the text lives only in this result.
    const text = chunks.join('');
    chunks = [];
    const decision = await decisionPromise;
    if (aborted) {
      return { text, decision, attest: null };
    }
    const rendered = finishOptions?.rendered ?? options?.rendered;
    const signal = finishOptions?.signal ?? options?.signal;
    const attest = await attestAnswer(client, decision, text, rendered, signal);
    return { text, decision, attest };
  };

  return {
    decisionPromise,

    onChunk: (chunk: string): void => {
      // After finish() the text is settled and after abort() nothing will be hashed, so late
      // chunks are dropped rather than silently changing a hash that was already sent.
      if (finished === null && !aborted) {
        chunks.push(chunk);
      }
    },

    /** Terminal and idempotent: every call returns the promise the first call created. */
    finish: (finishOptions?: StreamFinishOptions): Promise<StreamResult> => {
      finished ??= run(finishOptions);
      return finished;
    },

    /**
     * The stream failed (the model errored, the user navigated away): nothing may be attested,
     * because the text is not what the user saw. A later finish resolves with attest null and
     * the text accumulated so far. It does not cancel an evaluate already in flight; pass a
     * signal in the options for that.
     */
    abort: (): void => {
      aborted = true;
    },
  };
};
