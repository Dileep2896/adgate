import { attest, type AuditSigningKey, type Clock, nextPrevHash } from '@adgateio/core';
import { AttestRequest } from '@adgateio/schemas';
import type { Context } from 'hono';

import type { AppEnv } from '../app-env.js';
import { errorResponse } from '../http-error.js';
import { INVALID_REQUEST_CODE, parseJsonBody } from '../request-body.js';
import type { AttestStore } from './store.js';

/**
 * POST /v1/attest (docs/api.md), mounted behind bearerAuth({ roles: ['app'] }). The SDK calls
 * it once the model's answer is complete with the hash of that answer; the record is re-hashed
 * and re-signed as a new version with separation_attestation true (core attest, S15) and
 * stored by attest/store.ts. Answers: 204 on success; 400 invalid_request for a body that is
 * not an AttestRequest; 404 not_found when no record with that id belongs to the caller's app
 * (another app's id looks exactly like an unknown one); 409 already_attested when the latest
 * version already is. The log line carries ids and the seq, never the hash of the answer.
 */
export const ALREADY_ATTESTED_CODE = 'already_attested';

export interface AttestDeps {
  signing: AuditSigningKey;
  /** Milliseconds clock for attested_at. */
  now: Clock;
  store: AttestStore;
}

export const attestRoute =
  (deps: AttestDeps) =>
  async (c: Context<AppEnv>): Promise<Response> => {
    const log = c.get('logger');
    const parsed = await parseJsonBody(c, AttestRequest, 'AttestRequest');
    if (!parsed.ok) {
      log.info({ status: 400 }, 'attest rejected: invalid request');
      return errorResponse(c, 400, INVALID_REQUEST_CODE, parsed.message);
    }
    const { audit_id, model_output_hash, rendered } = parsed.data;
    const outcome = await deps.store.attest({
      appId: c.get('auth').app_id,
      auditId: audit_id,
      rendered,
      build: (current, latest) =>
        attest(current, model_output_hash, new Date(deps.now()).toISOString(), {
          prev_hash: nextPrevHash(latest),
          signing: deps.signing,
        }),
    });
    if (!outcome.ok) {
      if (outcome.reason === 'not_found') {
        log.info({ status: 404, audit_id }, 'attest rejected: unknown audit id');
        return errorResponse(c, 404, 'not_found', `audit record ${audit_id} not found`);
      }
      log.info({ status: 409, audit_id }, 'attest rejected: already attested');
      return errorResponse(
        c,
        409,
        ALREADY_ATTESTED_CODE,
        `audit record ${audit_id} is already attested`,
      );
    }
    log.info(
      { audit_id, seq: outcome.seq, superseded_seq: outcome.supersededSeq, rendered },
      'attest',
    );
    return c.body(null, 204);
  };
