import type { HealthResponse } from '@adgate/schemas';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'pino';

import type { AppEnv } from './app-env.js';
import { createAuditReader } from './audit-api/loader.js';
import { auditRecordRoute, verifyRoute } from './audit-api/route.js';
import { attestRoute } from './attest/route.js';
import { createAttestStore } from './attest/store.js';
import { bearerAuth } from './auth/middleware.js';
import { createApiKeyStore } from './auth/repository.js';
import { clickRoute } from './click/route.js';
import { createClickStore } from './click/store.js';
import type { Db } from './db/client.js';
import { eventsRoute } from './events/route.js';
import { createEventStore } from './events/store.js';
import type { EvaluateDeps } from './evaluate/deps.js';
import { evaluateRoute } from './evaluate/route.js';
import { errorCode, errorResponse } from './http-error.js';
import { REQUEST_ID_HEADER, requestContext } from './request-id.js';

export { errorCode, errorResponse } from './http-error.js';

/**
 * The Hono application. createApp wires middleware and routes around injected dependencies
 * and returns the app without binding a port, so tests drive it with app.request() and
 * server.ts serves it. Routes arrive story by story: GET /healthz; when evaluate deps are given,
 * POST /v1/evaluate, /v1/attest and /v1/events behind bearerAuth (app keys), GET /v1/audit/:id
 * and /v1/verify/:id behind bearerAuth (app or advertiser_read keys) and the public click
 * redirect GET /c/:audit_id, all sharing the evaluate deps' database, keys and clock; a body
 * size limit ahead of every route; and the docs/api.md error behaviour: every non-2xx body is
 * { error: { code, message } }.
 */

export interface AppDeps {
  logger: Logger;
  /** Browser origins allowed by CORS (CORS_ALLOWED_ORIGINS). Empty = no browser origin. */
  corsAllowedOrigins: readonly string[];
  /** The Drizzle database. Optional until a route needs it, so unit tests run without Postgres. */
  db?: Db | undefined;
  /**
   * Mounts /v1/evaluate, /v1/attest, /v1/events, /v1/audit/:id, /v1/verify/:id and /c/:audit_id
   * (createEvaluateDeps supplies the db, keys, clock and policy loader they share). Absent =
   * none of them exists.
   */
  evaluate?: EvaluateDeps | undefined;
}

export type App = Hono<AppEnv>;

/**
 * The largest request body any route reads (256 KiB; an EvaluateRequest with four 4,000 code
 * point messages is under 20 KiB). Larger bodies are 413 payload_too_large before a route runs.
 * S36 (load and abuse) confirms or tunes the figure.
 */
export const BODY_LIMIT_BYTES = 256 * 1024;

const payloadTooLarge = (): never => {
  throw new HTTPException(413, {
    message: `request body exceeds ${BODY_LIMIT_BYTES} bytes`,
  });
};

export const createApp = (deps: AppDeps): App => {
  const app = new Hono<AppEnv>();

  app.use('*', requestContext(deps.logger));
  app.use(
    '*',
    cors({
      origin: [...deps.corsAllowedOrigins],
      allowHeaders: ['Authorization', 'Content-Type', REQUEST_ID_HEADER],
      exposeHeaders: [REQUEST_ID_HEADER],
      maxAge: 600,
    }),
  );
  app.use('*', bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: payloadTooLarge }));

  app.get('/healthz', (c) => {
    const body: HealthResponse = { ok: true };
    return c.json(body);
  });

  if (deps.evaluate !== undefined) {
    const { db, signing, ring, now, policies } = deps.evaluate;
    const keyStore = createApiKeyStore(db);
    const appKey = bearerAuth({ store: keyStore, roles: ['app'] });
    const readKey = bearerAuth({ store: keyStore, roles: ['app', 'advertiser_read'] });
    const auditApi = { ring, reader: createAuditReader(db) };
    app.post('/v1/evaluate', appKey, evaluateRoute(deps.evaluate));
    app.post('/v1/attest', appKey, attestRoute({ signing, now, store: createAttestStore(db) }));
    app.post('/v1/events', appKey, eventsRoute({ store: createEventStore(db, { now }) }));
    app.get('/v1/audit/:id', readKey, auditRecordRoute(auditApi));
    app.get('/v1/verify/:id', readKey, verifyRoute(auditApi));
    app.get('/c/:audit_id', clickRoute({ now, policies, store: createClickStore(db, { now }) }));
  }

  app.notFound((c) =>
    errorResponse(c, 404, 'not_found', `No route for ${c.req.method} ${c.req.path}`),
  );

  app.onError((error, c) => {
    const log = c.get('logger') ?? deps.logger;
    if (error instanceof HTTPException) {
      // Deliberate rejections from middleware and routes (auth, validation, rate limits).
      const status = error.status;
      const code = errorCode(status);
      const message = error.message !== '' ? error.message : code.replace(/_/g, ' ');
      log.warn({ status, path: c.req.path }, 'request rejected');
      return errorResponse(c, status, code, message, error.res?.headers);
    }
    // Anything else is a bug or an outage: log it with the request id, never expose it.
    log.error({ err: error, path: c.req.path }, 'unhandled error');
    return errorResponse(c, 500, 'internal_error', 'Internal error');
  });

  return app;
};
