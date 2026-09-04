import type { EvaluateResult } from '../types.js';

/**
 * One turn, not one model call. A tool-using generation calls the model several times for a
 * single question, and each of those steps reaches the middleware separately. Evaluating every
 * step would burn a frequency cap slot per step, write one audit record per step, and attest a
 * half-finished answer, so the steps of one turn share a single evaluation here.
 *
 * The key is the app's own conversation and turn ids: the store can only join steps an app has
 * given stable ids. With the generated defaults every call is its own turn (and its own
 * conversation), which is why real apps must pass their ids.
 */

/** Enough for the concurrent turns of one process; the map is per adgateMiddleware() instance. */
export const MAX_TRACKED_TURNS = 32;

export type TurnStore = {
  /** The evaluation already running for this turn, or undefined for a turn's first step. */
  get(key: string): Promise<EvaluateResult> | undefined;
  /** Remembers `evaluation`, evicting the oldest turn when the map is full. */
  set(key: string, evaluation: Promise<EvaluateResult>): void;
  /** Forgets a finished turn. A turn that never finishes is evicted by age instead. */
  end(key: string): void;
  size(): number;
};

export const createTurnStore = (max: number = MAX_TRACKED_TURNS): TurnStore => {
  // Insertion-ordered, so the first key is always the oldest turn still tracked.
  const turns = new Map<string, Promise<EvaluateResult>>();
  return {
    get: (key) => turns.get(key),
    set: (key, evaluation) => {
      turns.set(key, evaluation);
      while (turns.size > max) {
        const oldest = turns.keys().next();
        if (oldest.done === true) {
          return;
        }
        turns.delete(oldest.value);
      }
    },
    end: (key) => {
      turns.delete(key);
    },
    size: () => turns.size,
  };
};

/** A NUL separator, so ids containing the separator cannot collide with a different pair. */
export const turnKey = (conversationId: string, turnId: string): string =>
  `${conversationId}\u0000${turnId}`;

/**
 * A fresh conversation id, used only when the app supplies none. It is per CALL, never per
 * middleware instance: a module-scope middleware is shared by every user the process serves, and
 * one shared id would put all of them in one frequency-cap bucket under one conversation hash.
 */
export const newConversationId = (): string =>
  `adgate_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * The unified finish reason of a generate result or a `finish` stream part, read structurally:
 * the AI SDK moved it from a bare string to `{ unified, raw }`, and both shapes appear in the
 * wild. Null when the provider reported none.
 */
export const finishReasonOf = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const unified = (value as { unified?: unknown }).unified;
    if (typeof unified === 'string') {
      return unified;
    }
  }
  return null;
};

/**
 * Whether this step ends the turn, i.e. whether its text is the answer the user reads.
 * 'tool-calls' means the SDK will call the model again with the tool output, so that step's text
 * is partial and must not be attested. An unknown or missing reason counts as final: attesting
 * an answer that turns out to be intermediate is better than never attesting one at all.
 */
export const isTurnFinal = (finishReason: string | null): boolean => finishReason !== 'tool-calls';
