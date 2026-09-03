import {
  type BuildAuditRecordInput,
  buildAuditRecord,
  conversationIdHash,
  failClosedClassification,
  latencySince,
  nextPrevHash,
  prefixedUlid,
  userHash,
} from '@adgate/core';
import { Disclosure } from '@adgate/schemas';
import type { Logger } from 'pino';

import type { AppRow } from '../db/tables/apps.js';
import { utcDay } from './caps.js';
import type { EvaluateDeps } from './deps.js';
import { errorEvaluateResponse } from './response.js';
import type { EvaluateContext, EvaluateResult } from './types.js';

/**
 * The fail-closed path of evaluate (docs/api.md "Error behavior"): a suppress/error record
 * built from the zeroed classification, chained and signed like any other, and the documented
 * error response. When even that record cannot be written, the response still carries a fresh
 * audit_id (the schema requires one) and an error-level line names it: later attest, events
 * and verify calls for that id answer 404, which the SDK treats as non-fatal. Logs the error's
 * name only, never a message (driver messages can quote values).
 */
export const AUDIT_ID_PREFIX = 'aud_';

export const errorName = (error: unknown): string =>
  error instanceof Error && error.name !== '' ? error.name : 'NonError';

/** The policy's disclosure for the error record, or the documented default when unreadable. */
const disclosureOf = (deps: EvaluateDeps, app: AppRow, log: Logger): Disclosure => {
  try {
    return deps.policies.load(app, log).disclosure;
  } catch {
    return Disclosure.parse({});
  }
};

export const failClosed = async (
  deps: EvaluateDeps,
  ctx: EvaluateContext,
  error: unknown,
): Promise<EvaluateResult> => {
  const { app, request, log } = ctx;
  const error_name = errorName(error);
  log.error({ error_name }, 'evaluate failed; suppressing with reason error');
  const now = deps.now;
  const auditId = prefixedUlid(AUDIT_ID_PREFIX, { now });
  const latency = () => latencySince(now, ctx.started);
  try {
    const base: Omit<BuildAuditRecordInput, 'prev_hash'> = {
      id: auditId,
      app: { app_id: app.id, salt: app.salt },
      conversation_id: request.conversation_id,
      user_hash: request.user.user_hash,
      turn_id: request.turn_id,
      ts: new Date(now()).toISOString(),
      surface: request.surface,
      classification: failClosedClassification(),
      policy: {
        policy_version: app.policyVersion,
        policy_hash: app.policyHash,
        disclosure: disclosureOf(deps, app, log),
      },
      policyResult: { allowed: false, reason: 'error', decisions: [] },
      mediation: null,
      signing: deps.signing,
    };
    const persisted = await deps.auditStore.persist({
      appId: app.id,
      build: (previous) => buildAuditRecord({ ...base, prev_hash: nextPrevHash(previous) }),
      caps: {
        conversationHash: conversationIdHash(app.salt, request.conversation_id),
        userHash: userHash(app.salt, request.user.user_hash),
        day: utcDay(now()),
        now: new Date(now()),
      },
      advertiserId: null,
      rawText: null,
    });
    return {
      response: errorEvaluateResponse(persisted.record.id, latency()),
      diagnostics: { error_name, persisted: true, seq: persisted.seq },
    };
  } catch (persistError) {
    log.error(
      { error_name: errorName(persistError), audit_id: auditId },
      'audit record not persisted; the returned audit_id has no record',
    );
    return {
      response: errorEvaluateResponse(auditId, latency()),
      diagnostics: { error_name, persisted: false },
    };
  }
};
