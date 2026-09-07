import { EventRequest } from '@adgateio/schemas';
import type { Context } from 'hono';

import type { AppEnv } from '../app-env.js';
import { errorResponse } from '../http-error.js';
import { INVALID_REQUEST_CODE, parseJsonBody } from '../request-body.js';
import type { EventStore } from './store.js';

/**
 * POST /v1/events (docs/api.md), mounted behind bearerAuth({ roles: ['app'] }). Validates the
 * EventRequest (400 invalid_request, also for a meta object over MAX_EVENT_META_BYTES once
 * serialized), checks the audit id against the caller: 404 not_found when no record has that
 * id, 403 forbidden when the record belongs to another app (the story's contract), then
 * inserts the row attributed to the KEY'S app, never a body field. A duplicate impression is
 * a 204 like the first one. The log line names the audit id and type; meta is never logged.
 */
export const MAX_EVENT_META_BYTES = 4096;
export const FOREIGN_AUDIT_MESSAGE = 'audit_id belongs to another app';

export interface EventsDeps {
  store: EventStore;
}

/** Serialized size of meta in bytes; what jsonb stores is bounded by it. */
export const metaByteLength = (meta: Record<string, unknown>): number =>
  Buffer.byteLength(JSON.stringify(meta), 'utf8');

export const eventsRoute =
  (deps: EventsDeps) =>
  async (c: Context<AppEnv>): Promise<Response> => {
    const log = c.get('logger');
    const parsed = await parseJsonBody(c, EventRequest, 'EventRequest');
    if (!parsed.ok) {
      log.info({ status: 400 }, 'event rejected: invalid request');
      return errorResponse(c, 400, INVALID_REQUEST_CODE, parsed.message);
    }
    const { audit_id, type, ts } = parsed.data;
    const meta = parsed.data.meta ?? {};
    if (metaByteLength(meta) > MAX_EVENT_META_BYTES) {
      log.info({ status: 400, audit_id, type }, 'event rejected: meta too large');
      return errorResponse(
        c,
        400,
        INVALID_REQUEST_CODE,
        `meta exceeds ${MAX_EVENT_META_BYTES} bytes when serialized`,
      );
    }
    const appId = c.get('auth').app_id;
    const owner = await deps.store.ownerOf(audit_id);
    if (owner === null) {
      log.info({ status: 404, audit_id, type }, 'event rejected: unknown audit id');
      return errorResponse(c, 404, 'not_found', `audit record ${audit_id} not found`);
    }
    if (owner !== appId) {
      log.info({ status: 403, audit_id, type }, 'event rejected: foreign audit id');
      return errorResponse(c, 403, 'forbidden', FOREIGN_AUDIT_MESSAGE);
    }
    const result = await deps.store.insert({
      auditId: audit_id,
      appId,
      type,
      ts: new Date(ts),
      meta,
    });
    log.info({ audit_id, type, duplicate: result === 'duplicate' }, 'event');
    return c.body(null, 204);
  };
