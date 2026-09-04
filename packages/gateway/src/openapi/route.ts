import type { Context } from 'hono';

import type { AppEnv } from '../app-env.js';
import type { OpenApiDocument } from './document.js';

/**
 * GET /openapi.json: public, serialized once, cached by clients for five minutes (the
 * document only changes with a deploy). No database, no auth.
 */
export const OPENAPI_CACHE_CONTROL = 'public, max-age=300';

export const openApiRoute = (document: OpenApiDocument) => {
  const body = JSON.stringify(document);
  return (c: Context<AppEnv>): Response =>
    c.body(body, 200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': OPENAPI_CACHE_CONTROL,
    });
};
