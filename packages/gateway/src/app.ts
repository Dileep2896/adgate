import type { HealthResponse } from '@adgate/schemas';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'pino';

import type { AppEnv } from './app-env.js';
import { BODY_LIMIT_BYTES } from './body-limit.js';
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
import { buildOpenApiDocument } from './openapi/document.js';
import { openApiRoute } from './openapi/route.js';
import type { RateLimiter } from './rate-limit/limiter.js';
import { rateLimit } from './rate-limit/middleware.js';
import { requestContext } from './request-id.js';
import { corsPolicy, securityHeaders } from './security.js';

export { errorCode, errorResponse } from './http-error.js';
export { BODY_LIMIT_BYTES } from './body-limit.js';

/**
 * The Hono application. createApp wires middleware and routes around injected dependencies
 * and returns the app without binding a port, so tests drive it with app.request() and
 * server.ts serves it. Routes arrive story by story: GET /healthz; when evaluate deps are given,
 * POST /v1/evaluate, /v1/attest and /v1/events behind bearerAuth (app keys), GET /v1/audit/:id
 * and /v1/verify/:id behind bearerAuth (app or advertiser_read keys) and the public click
 * redirect GET /c/:audit_id, all sharing the evaluate deps' database, keys and clock; a
 * per-key token bucket after bearerAuth on the three write endpoints (429 + Retry-After) when
 * a rate limiter is given; GET /openapi.json built once from the Zod schemas; a body size
 * limit ahead of every route; the security.ts response headers and CORS allowlist (an origin
 * off CORS_ALLOWED_ORIGINS gets no CORS headers and its preflight is 403); and the
 * docs/api.md error behaviour: every non-2xx body is
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
  /**
   * The token bucket behind POST /v1/evaluate, /v1/attest and /v1/events, keyed by API key id
   * (rate-limit/). Absent = those routes are not limited (unit tests without Postgres);
   * server.ts always passes the Postgres limiter.
   */
  rateLimiter?: RateLimiter | undefined;
}

export type App = Hono<AppEnv>;

const passthrough = createMiddleware<AppEnv>(async (_c, next) => {
  await next();
});

const payloadTooLarge = (): never => {
  throw new HTTPException(413, {
    message: `request body exceeds ${BODY_LIMIT_BYTES} bytes`,
  });
};

export const createApp = (deps: AppDeps): App => {
  const app = new Hono<AppEnv>();

  app.use('*', requestContext(deps.logger));
  app.use('*', securityHeaders());
  app.use('*', corsPolicy(deps.corsAllowedOrigins));
  app.use('*', bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: payloadTooLarge }));

  app.get('/healthz', (c) => {
    const body: HealthResponse = { ok: true };
    return c.json(body);
  });
  app.get(
    '/openapi.json',
    openApiRoute(buildOpenApiDocument({ serverUrl: deps.evaluate?.publicBaseUrl })),
  );

  if (deps.evaluate !== undefined) {
    const { db, signing, ring, now, policies } = deps.evaluate;
    const keyStore = createApiKeyStore(db);
    const appKey = bearerAuth({ store: keyStore, roles: ['app'] });
    const readKey = bearerAuth({ store: keyStore, roles: ['app', 'advertiser_read'] });
    // One bucket per API key, shared by the three write endpoints; a no-op without a limiter.
    const limited =
      deps.rateLimiter === undefined
        ? passthrough
        : rateLimit({ limiter: deps.rateLimiter, keyOf: (c) => c.get('auth').key_id, now });
    const auditApi = { ring, reader: createAuditReader(db) };
    app.post('/v1/evaluate', appKey, limited, evaluateRoute(deps.evaluate));
    app.post(
      '/v1/attest',
      appKey,
      limited,
      attestRoute({ signing, now, store: createAttestStore(db) }),
    );
    app.post('/v1/events', appKey, limited, eventsRoute({ store: createEventStore(db, { now }) }));
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
