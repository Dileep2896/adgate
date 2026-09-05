import { ErrorResponse, EvaluateResponse, MESSAGE_CONTENT_MAX_CHARS } from '@adgate/schemas';
import { count } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BODY_LIMIT_BYTES } from './app.js';
import { auditRecords, events } from './db/schema.js';
import { createHarness, evaluateBody, type Harness } from './evaluate/test-support.js';
import { CACHE_CONTROL_HEADER, HSTS_HEADER, NO_STORE, SECURITY_HEADERS } from './security.js';
import { getAudit, getClick, postJson } from './test-support/routes.js';

/**
 * S36 against the wired routes: the body limit on the three documented POST endpoints, the
 * response headers on real responses (including the click redirect, which keeps its own
 * no-store), and the Message.content cap. security.test.ts covers the same middleware without
 * a database.
 */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

const POST_PATHS = ['/v1/evaluate', '/v1/attest', '/v1/events'] as const;

const rowCounts = async (): Promise<{ audits: number; events: number }> => ({
  audits: (await h.handle.db.select({ n: count() }).from(auditRecords))[0]?.n ?? -1,
  events: (await h.handle.db.select({ n: count() }).from(events))[0]?.n ?? -1,
});

const expectSecurityHeaders = (res: Response, path: string): void => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(res.headers.get(name), `${name} on ${path}`).toBe(value);
  }
  // Plain http in the tests: HSTS must not be pinned into a developer's browser.
  expect(res.headers.get(HSTS_HEADER), `HSTS on ${path}`).toBeNull();
};

describe('body limit on the documented endpoints', () => {
  it('answers 413 payload_too_large and writes nothing', async () => {
    const oversized = JSON.stringify({ pad: 'x'.repeat(BODY_LIMIT_BYTES) });
    expect(oversized.length).toBeGreaterThan(BODY_LIMIT_BYTES);
    const before = await rowCounts();
    for (const path of POST_PATHS) {
      const res = await postJson(h, path, null, { raw: oversized });
      expect(res.status, path).toBe(413);
      const body = ErrorResponse.parse(await res.json());
      expect(body.error.code).toBe('payload_too_large');
      expect(body.error.message).toContain(String(BODY_LIMIT_BYTES));
      expectSecurityHeaders(res, path);
    }
    expect(await rowCounts()).toEqual(before);
  });

  it('accepts a request comfortably under the limit', async () => {
    const res = await h.post(evaluateBody(h.appId));
    expect(res.status).toBe(200);
  });
});

describe('Message.content cap', () => {
  it('rejects a single message over the cap and accepts one at it', async () => {
    const atLimit = await h.post(
      evaluateBody(h.appId, { content: 'a'.repeat(MESSAGE_CONTENT_MAX_CHARS) }),
    );
    expect(atLimit.status).toBe(200);
    expect(EvaluateResponse.parse(await atLimit.json()).audit_id).toMatch(/^aud_/);

    const over = await h.post(
      evaluateBody(h.appId, { content: 'a'.repeat(MESSAGE_CONTENT_MAX_CHARS + 1) }),
    );
    expect(over.status).toBe(400);
    const body = ErrorResponse.parse(await over.json());
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toContain('messages.0.content');
    // The rejection names the path and the limit, never the text the caller sent.
    expect(body.error.message).not.toContain('aaaa');
  });
});

describe('response headers', () => {
  it('are on the health check, a served evaluation, a 404 and a 401', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));

    const healthz = await h.app.request('/healthz');
    expect(healthz.status).toBe(200);
    expectSecurityHeaders(healthz, '/healthz');
    // A public route stays cacheable: no-store is only for authenticated answers.
    expect(healthz.headers.get(CACHE_CONTROL_HEADER)).toBeNull();

    const evaluated = await h.post(evaluateBody(h.appId));
    expect(evaluated.status).toBe(200);
    expectSecurityHeaders(evaluated, '/v1/evaluate');
    expect(evaluated.headers.get(CACHE_CONTROL_HEADER)).toBe(NO_STORE);

    const audit = await getAudit(h, served.audit_id);
    expect(audit.status).toBe(200);
    expectSecurityHeaders(audit, '/v1/audit/:id');
    expect(audit.headers.get(CACHE_CONTROL_HEADER)).toBe(NO_STORE);

    const missing = await h.app.request('/v1/nope');
    expect(missing.status).toBe(404);
    expectSecurityHeaders(missing, '404');

    const unauthorized = await h.post(evaluateBody(h.appId), { apiKey: null });
    expect(unauthorized.status).toBe(401);
    expectSecurityHeaders(unauthorized, '401');
  });

  it('keep the click redirect’s own no-store and no-referrer', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    const click = await getClick(h, served.audit_id);
    expect(click.status).toBe(302);
    expect(click.headers.get(CACHE_CONTROL_HEADER)).toBe(NO_STORE);
    expect(click.headers.get('referrer-policy')).toBe('no-referrer');
    expectSecurityHeaders(click, '/c/:audit_id');
  });

  it('set HSTS when a proxy says the hop to it was https', async () => {
    const res = await h.app.request('/healthz', { headers: { 'x-forwarded-proto': 'https' } });
    expect(res.headers.get(HSTS_HEADER)).toBe('max-age=31536000; includeSubDomains');
  });
});
