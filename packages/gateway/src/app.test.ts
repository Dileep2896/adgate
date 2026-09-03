import { ErrorResponse, HealthResponse } from '@adgate/schemas';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createLogger } from './logger.js';
import { collectLogs } from './test-support/logs.js';

const build = (corsAllowedOrigins: string[] = []) => {
  const { lines, stream } = collectLogs();
  const logger = createLogger({ level: 'info' }, stream);
  const app = createApp({ logger, corsAllowedOrigins });
  app.get('/boom', () => {
    throw new Error('boom-detail');
  });
  app.get('/teapot', () => {
    throw new HTTPException(418, { message: 'short and stout' });
  });
  app.get('/unauthorized', () => {
    throw new HTTPException(401);
  });
  return { app, lines };
};

describe('createApp', () => {
  it('GET /healthz returns { ok: true }', async () => {
    const { app } = build();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(HealthResponse.parse(await res.json())).toEqual({ ok: true });
  });

  it('answers an unknown route with the docs/api.md error body', async () => {
    const { app } = build();
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('/nope');
  });

  it('turns an unexpected throw into a 500 error body without leaking the cause', async () => {
    const { app, lines } = build();
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).not.toContain('boom-detail');
    const errorLine = lines.find((line) => line.includes('"level":50'));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain('boom-detail');
    expect(errorLine).toContain('/boom');
  });

  it('keeps the status and message of an HTTPException', async () => {
    const { app } = build();
    const teapot = await app.request('/teapot');
    expect(teapot.status).toBe(418);
    expect(ErrorResponse.parse(await teapot.json()).error).toEqual({
      code: 'http_418',
      message: 'short and stout',
    });

    const unauthorized = await app.request('/unauthorized');
    expect(unauthorized.status).toBe(401);
    expect(ErrorResponse.parse(await unauthorized.json()).error.code).toBe('unauthorized');
  });

  it('allows only the configured CORS origins', async () => {
    const { app } = build(['http://localhost:3000']);
    const allowed = await app.request('/healthz', {
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');

    const denied = await app.request('/healthz', { headers: { origin: 'https://evil.example' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();

    const preflight = await app.request('/v1/evaluate', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
