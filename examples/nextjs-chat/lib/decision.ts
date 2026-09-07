import { failClosedEvaluate, type EvaluateResult } from '@adgateio/sdk';

/**
 * How long /api/chat waits for the gateway once the answer is complete.
 *
 * The middleware's `onDecision` always fires (its evaluate promise never rejects), so this only
 * guards against a hand-rolled client that never answers. It fails closed: no decision means a
 * suppress, never a missing data part and never a blocked stream.
 *
 * A Next.js route file may only export the fields Next knows about, which is why this lives here
 * rather than in app/api/chat/route.ts.
 */

export const DECISION_TIMEOUT_MS = 3_000;

export const failClosedDecision = (): EvaluateResult =>
  failClosedEvaluate({ kind: 'timeout' }, DECISION_TIMEOUT_MS);

export const withDecisionTimeout = (
  decision: Promise<EvaluateResult>,
  timeoutMs: number = DECISION_TIMEOUT_MS,
): Promise<EvaluateResult> =>
  Promise.race([
    decision,
    new Promise<EvaluateResult>((resolve) => {
      setTimeout(() => {
        resolve(failClosedDecision());
      }, timeoutMs);
    }),
  ]);
