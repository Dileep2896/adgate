import type { ErrorResponse, HealthResponse } from '@adgate/schemas';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Logger } from 'pino';

import type { AppEnv } from './app-env.js';
import type { Db } from './db/client.js';
import { REQUEST_ID_HEADER, requestContext } from './request-id.js';

/**
 * The Hono application. createApp wires middleware and routes around injected dependencies
 * and returns the app without binding a port, so tests drive it with app.request() and
 * server.ts serves it. Routes arrive story by story; this skeleton has GET /healthz and the
 * docs/api.md error behaviour: every non-2xx body is { error: { code, message } }.
 */

export interface AppDeps {
  logger: Logger;
  /** Browser origins allowed by CORS (CORS_ALLOWED_ORIGINS). Empty = no browser origin. */
  corsAllowedOrigins: readonly string[];
  /** The Drizzle database. Optional until a route needs it, so unit tests run without Postgres. */
  db?: Db | undefined;
}

export type App = Hono<AppEnv>;

const ERROR_CODES: Readonly<Partial<Record<number, string>>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable',
  429: 'rate_limited',
  500: 'internal_error',
  503: 'unavailable',
};

/** The stable error code for a status: a named one, or http_<status>. */
export const errorCode = (status: number): string => ERROR_CODES[status] ?? `http_${status}`;

export const errorResponse = (
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  headers?: Headers,
): Response => {
  const body: ErrorResponse = { error: { code, message } };
  const res = c.json(body, status);
  headers?.forEach((value, name) => {
    res.headers.set(name, value);
  });
  return res;
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

  app.get('/healthz', (c) => {
    const body: HealthResponse = { ok: true };
    return c.json(body);
  });

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
