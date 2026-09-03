import type { ErrorResponse } from '@adgate/schemas';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { AppEnv } from './app-env.js';

/**
 * The docs/api.md error body, `{ error: { code, message } }`, rendered by app.ts for 404/500
 * and by routes that reject a request themselves (evaluate's 400 and 403). Lives apart from
 * app.ts so route modules can import it without a cycle.
 */

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
