import { failClosedEvaluate } from './client.js';
import type {
  AdgateClient,
  AttestResult,
  EvaluateRequest,
  EvaluateResult,
  RenderedOption,
  WithGenerationOptions,
  WithGenerationResult,
} from './types.js';

/**
 * withGeneration covers a whole turn in one call: it asks the gateway whether a sponsored slot
 * is allowed WHILE the model is generating, then attests the finished answer. The two run
 * concurrently on purpose, so adgate adds no latency to the answer the user waits for.
 *
 * The only error that ever reaches the caller is the caller's own: if `generate` rejects, that
 * rejection propagates untouched and nothing is attested (there is no answer to attest). Every
 * adgate-side failure is absorbed, exactly as the client's never-rejects contract requires.
 */

/**
 * Starts evaluate now and returns a promise that always resolves. The catch is attached in the
 * same tick as the call: `generate` may reject first and abandon this promise, and an abandoned
 * rejected promise would be an unhandled rejection that crashes a Node process.
 */
export const startEvaluate = (
  client: AdgateClient,
  request: EvaluateRequest,
  signal: AbortSignal | undefined,
): Promise<EvaluateResult> => {
  const started = Date.now();
  const failClosed = () => failClosedEvaluate({ kind: 'network' }, Date.now() - started);
  const options = signal === undefined ? undefined : { signal };
  try {
    return Promise.resolve(client.evaluate(request, options)).catch(failClosed);
  } catch {
    // A client that throws synchronously is not the adgate client, but the turn still proceeds.
    return Promise.resolve(failClosed());
  }
};

/** Default: the ad was rendered exactly when the gateway said serve. */
export const resolveRendered = (
  rendered: RenderedOption | undefined,
  decision: EvaluateResult,
): boolean => {
  if (typeof rendered === 'boolean') {
    return rendered;
  }
  if (typeof rendered === 'function') {
    try {
      return Boolean(rendered(decision));
    } catch {
      // A throwing predicate is a caller bug; fall through to the default rather than break
      // the turn. The audit record then says what the decision said.
    }
  }
  return decision.decision === 'serve';
};

/**
 * Attests `text` against the decision's audit id, or does nothing when there is no record to
 * attest against (evaluate failed client-side, so audit_id is null). Never rejects.
 */
export const attestAnswer = async (
  client: AdgateClient,
  decision: EvaluateResult,
  text: string,
  rendered: RenderedOption | undefined,
  signal: AbortSignal | undefined,
): Promise<AttestResult | null> => {
  const auditId = decision.audit_id;
  if (auditId === null || auditId.length === 0) {
    return null;
  }
  const options = { rendered: resolveRendered(rendered, decision), ...(signal ? { signal } : {}) };
  try {
    return await client.attest(auditId, text, options);
  } catch {
    // The client never rejects; a hand-rolled one might, and adgate still must not break the app.
    return { ok: false, error: 'network' };
  }
};

/**
 * Runs `client.evaluate(request)` and `generate()` concurrently, awaits both, attests the full
 * answer text (only its sha256 leaves the process) and returns all three results.
 *
 * - `generate` rejects  -> this rejects with that error and nothing is attested.
 * - evaluate fails      -> the answer is still returned with a suppress/error decision,
 *                          `attest` is null (there is no audit record to attest against).
 * - otherwise           -> attest is called exactly once with the hash of the FULL answer.
 */
export const withGeneration = async (
  client: AdgateClient,
  request: EvaluateRequest,
  generate: () => Promise<string>,
  options?: WithGenerationOptions,
): Promise<WithGenerationResult> => {
  const signal = options?.signal;
  const evaluation = startEvaluate(client, request, signal);
  const answer = await generate();
  const decision = await evaluation;
  const attest = await attestAnswer(client, decision, answer, options?.rendered, signal);
  return { answer, decision, attest };
};
