import { ulid } from '@adgateio/core';
import { createMiddleware } from 'hono/factory';
import type { Logger } from 'pino';

import type { AppEnv } from './app-env.js';

/**
 * Request ids and the request log. Each request gets the caller's X-Request-Id when it is a
 * single safe token, otherwise a fresh ULID; the id is echoed in the response header, bound to
 * a child logger available as c.get('logger'), and written in exactly one log line per request
 * carrying method, path, status and duration. Bodies, query strings and headers are never
 * logged (docs/api.md: errors are logged with a request id, nothing more).
 */

export const REQUEST_ID_HEADER = 'X-Request-Id';
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export const requestIdFrom = (header: string | undefined): string =>
  header !== undefined && REQUEST_ID_PATTERN.test(header) ? header : ulid();

export const requestContext = (logger: Logger) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const started = performance.now();
    const requestId = requestIdFrom(c.req.header(REQUEST_ID_HEADER));
    const log = logger.child({ req_id: requestId });
    c.set('requestId', requestId);
    c.set('logger', log);
    await next();
    c.res.headers.set(REQUEST_ID_HEADER, requestId);
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Math.round((performance.now() - started) * 10) / 10,
      },
      'request',
    );
  });
