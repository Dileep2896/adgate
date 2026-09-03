import type { HealthResponse } from '@adgate/schemas';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'pino';

import type { AppEnv } from './app-env.js';
import { bearerAuth } from './auth/middleware.js';
import { createApiKeyStore } from './auth/repository.js';
import type { Db } from './db/client.js';
import type { EvaluateDeps } from './evaluate/deps.js';
import { evaluateRoute } from './evaluate/route.js';
import { errorCode, errorResponse } from './http-error.js';
import { REQUEST_ID_HEADER, requestContext } from './request-id.js';

export { errorCode, errorResponse } from './http-error.js';

/**
 * The Hono application. createApp wires middleware and routes around injected dependencies
 * and returns the app without binding a port, so tests drive it with app.request() and
 * server.ts serves it. Routes arrive story by story: GET /healthz, POST /v1/evaluate (behind
 * bearerAuth, when evaluate deps are given), and the docs/api.md error behaviour: every
 * non-2xx body is { error: { code, message } }.
 */

export interface AppDeps {
  logger: Logger;
  /** Browser origins allowed by CORS (CORS_ALLOWED_ORIGINS). Empty = no browser origin. */
  corsAllowedOrigins: readonly string[];
  /** The Drizzle database. Optional until a route needs it, so unit tests run without Postgres. */
  db?: Db | undefined;
  /** Mounts POST /v1/evaluate (createEvaluateDeps). Absent = the route does not exist. */
  evaluate?: EvaluateDeps | undefined;
}

export type App = Hono<AppEnv>;

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

  app.get('/healthz', (c) => {
    const body: HealthResponse = { ok: true };
    return c.json(body);
  });

  if (deps.evaluate !== undefined) {
    const store = createApiKeyStore(deps.evaluate.db);
    app.post('/v1/evaluate', bearerAuth({ store, roles: ['app'] }), evaluateRoute(deps.evaluate));
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
