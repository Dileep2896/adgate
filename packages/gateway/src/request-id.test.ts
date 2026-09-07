import { isUlid } from '@adgateio/core';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createLogger } from './logger.js';
import { REQUEST_ID_HEADER } from './request-id.js';
import { collectLogs } from './test-support/logs.js';

const build = () => {
  const { lines, stream } = collectLogs();
  const logger = createLogger({ level: 'info' }, stream);
  return { app: createApp({ logger, corsAllowedOrigins: [] }), lines };
};

const entries = (lines: string[]): Record<string, unknown>[] =>
  lines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe('request ids', () => {
  it('echoes a well-formed X-Request-Id', async () => {
    const { app } = build();
    const res = await app.request('/healthz', { headers: { [REQUEST_ID_HEADER]: 'req-abc.123' } });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('req-abc.123');
  });

  it('mints a ULID when the header is absent', async () => {
    const { app } = build();
    const res = await app.request('/healthz');
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).not.toBeNull();
    expect(isUlid(id ?? '')).toBe(true);
  });

  it('replaces a malformed header with a ULID', async () => {
    const { app } = build();
    for (const bad of ['has space', 'x'.repeat(129), 'with/slash', 'a=b', '']) {
      const res = await app.request('/healthz', { headers: { [REQUEST_ID_HEADER]: bad } });
      expect(isUlid(res.headers.get(REQUEST_ID_HEADER) ?? '')).toBe(true);
    }
  });

  it('writes one request log line with the id, method, path and status', async () => {
    const { app, lines } = build();
    await app.request('/healthz?token=SECRET', { headers: { [REQUEST_ID_HEADER]: 'req-1' } });
    const [entry] = entries(lines);
    expect(entry).toMatchObject({ req_id: 'req-1', method: 'GET', path: '/healthz', status: 200 });
    expect(typeof entry?.['duration_ms']).toBe('number');
    expect(lines.join('\n')).not.toContain('SECRET');
  });

  it('never logs request bodies', async () => {
    const { app, lines } = build();
    await app.request('/v1/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer SECRET_KEY' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'SECRET_CONTENT' }] }),
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('SECRET_CONTENT');
    expect(lines.join('\n')).not.toContain('SECRET_KEY');
  });
});
