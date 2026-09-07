import { latencySince, prefixedUlid } from '@adgateio/core';
import { EvaluateRequest } from '@adgateio/schemas';
import type { Context } from 'hono';

import type { AppEnv } from '../app-env.js';
import { errorResponse } from '../http-error.js';
import type { GatewayMetrics } from '../metrics/instrument.js';
import { INVALID_REQUEST_CODE, parseJsonBody } from '../request-body.js';
import type { EvaluateDeps } from './deps.js';
import { AUDIT_ID_PREFIX } from './fail-closed.js';
import { evaluate } from './pipeline.js';
import { errorEvaluateResponse } from './response.js';

/**
 * POST /v1/evaluate (docs/api.md), mounted behind bearerAuth({ roles: ['app'] }). The HTTP
 * boundary does three things before the pipeline: reject a body that is not JSON or not an
 * EvaluateRequest with 400 invalid_request (request-body.ts), reject an app_id that is not the
 * key's with 403,
 * and hand the validated request to evaluate(), whose answer is always HTTP 200 (docs/api.md
 * "Error behavior"). One log line per evaluation carries ids, enums and timings, never the
 * messages, the context summary or the key.
 *
 * It is also where the evaluate metrics are recorded (S38), once per DECISION: a request
 * rejected at the boundary produced no decision and is only counted by
 * adgate_http_requests_total. The recorder swallows its own failures, so nothing here can turn
 * a metric into a response.
 */
export const APP_MISMATCH_MESSAGE = 'app_id does not belong to the API key';

type ParsedBody = { ok: true; request: EvaluateRequest } | { ok: false; message: string };

export const parseEvaluateBody = async (c: Context<AppEnv>): Promise<ParsedBody> => {
  const parsed = await parseJsonBody(c, EvaluateRequest, 'EvaluateRequest');
  return parsed.ok ? { ok: true, request: parsed.data } : parsed;
};

export const evaluateRoute =
  (deps: EvaluateDeps, metrics?: GatewayMetrics) =>
  async (c: Context<AppEnv>): Promise<Response> => {
    const started = deps.now();
    const log = c.get('logger');
    const parsed = await parseEvaluateBody(c);
    if (!parsed.ok) {
      log.info({ status: 400 }, 'evaluate rejected: invalid request');
      return errorResponse(c, 400, INVALID_REQUEST_CODE, parsed.message);
    }
    const app = c.get('app');
    if (parsed.request.app_id !== c.get('auth').app_id) {
      log.info({ status: 403 }, 'evaluate rejected: app_id mismatch');
      return errorResponse(c, 403, 'forbidden', APP_MISMATCH_MESSAGE);
    }

    try {
      const { response, diagnostics, demand } = await evaluate(deps, {
        app,
        request: parsed.request,
        log,
        started,
      });
      metrics?.recordEvaluation({
        decision: response.decision,
        reason: response.reason,
        durationMs: latencySince(deps.now, started),
        ...(diagnostics.cache_source === undefined
          ? {}
          : { cacheSource: diagnostics.cache_source }),
        ...(demand === undefined ? {} : { demand }),
      });
      // The request logger already carries req_id, key_id and app_id (bearerAuth).
      log.info(
        {
          audit_id: response.audit_id,
          decision: response.decision,
          reason: response.reason,
          latency_ms: response.latency_ms,
          classification_method: response.classification.method,
          ...diagnostics,
        },
        'evaluate',
      );
      return c.json(response, 200);
    } catch (error) {
      // Unreachable by design (evaluate never rejects); kept so the contract holds regardless.
      const auditId = prefixedUlid(AUDIT_ID_PREFIX);
      log.error(
        { error_name: error instanceof Error ? error.name : 'NonError', audit_id: auditId },
        'evaluate wrapper failed; the returned audit_id has no record',
      );
      metrics?.recordEvaluation({
        decision: 'suppress',
        reason: 'error',
        durationMs: latencySince(deps.now, started),
      });
      return c.json(errorEvaluateResponse(auditId, 0), 200);
    }
  };
