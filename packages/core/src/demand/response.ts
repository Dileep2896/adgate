import type { Candidate, DemandResponse, DemandSource } from '@adgateio/schemas';

/**
 * Response assembly shared by the in-memory adapters: a clock that never throws, a latency that
 * is always a non-negative integer, and error strings that never carry message text.
 */

/** Milliseconds clock. Date.now by default (fake-timer friendly; performance.now is not). */
export type Clock = () => number;

/** The clock's reading, or NaN when it throws (latency then reports 0). */
export const safeNow = (now: Clock): number => {
  try {
    return now();
  } catch {
    return Number.NaN;
  }
};

/** Milliseconds since `start`, rounded and clamped at 0; 0 when either reading is not finite. */
export const latencySince = (now: Clock, start: number): number => {
  const elapsed = Math.round(safeNow(now) - start);
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
};

/**
 * The thrown value's class name and nothing else, 'NonError' for anything that is not an Error
 * (or has an empty name). Never the message: an adapter's error string is copied by mediate()
 * into the demand trace of the signed audit record, and a message could quote anything.
 */
export const describeError = (error: unknown): string =>
  error instanceof Error && error.name !== '' ? error.name : 'NonError';

/** A DemandResponse without an `error` key unless there is one (exactOptionalPropertyTypes). */
export const demandResponse = (
  source: DemandSource,
  candidates: Candidate[],
  latency_ms: number,
  error?: string,
): DemandResponse =>
  error === undefined
    ? { source, candidates, latency_ms }
    : { source, candidates, latency_ms, error };
