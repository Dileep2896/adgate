import { ErrorResponse } from '@adgate/schemas';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';

import { type AppDeps, createApp } from '../app.js';
import { createLogger } from '../logger.js';
import { SECURITY_HEADERS } from '../security.js';
import { collectLogs } from '../test-support/logs.js';
import { EXPOSITION_CONTENT_TYPE } from './exposition.js';
import { METRICS_PATH } from './instrument.js';
import { createMetricsRegistry } from './registry.js';
import { bearerToken, METRICS_UNAUTHORIZED_MESSAGE, tokenMatches } from './route.js';
import { parseExposition } from './test-support.js';

const TOKEN = 'metrics-token-for-tests';

const build = (deps: Partial<AppDeps> = {}) => {
  const { lines, stream } = collectLogs();
  const logger = createLogger({ level: 'debug' }, stream);
  const app = createApp({ logger, corsAllowedOrigins: [], metricsToken: TOKEN, ...deps });
  const scrape = async (token: string | null = TOKEN): Promise<Response> =>
    app.request(METRICS_PATH, {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    });
  return { app, lines, scrape };
};

describe('GET /metrics', () => {
  it('answers 200 with a parseable exposition body for the configured token', async () => {
    const { scrape } = build();
    const res = await scrape();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(EXPOSITION_CONTENT_TYPE);
    expect(res.headers.get('cache-control')).toBe('no-store');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name), name).toBe(value);
    }
    const parsed = parseExposition(await res.text());
    for (const name of [
      'adgate_decisions_total',
      'adgate_evaluate_duration_seconds',
      'adgate_demand_adapter_duration_seconds',
      'adgate_classify_cache_total',
      'adgate_http_requests_total',
      'adgate_attest_total',
      'adgate_rate_limited_total',
      'adgate_process_uptime_seconds',
    ]) {
      expect(parsed.family(name).help.length).toBeGreaterThan(0);
    }
    expect(parsed.family('adgate_evaluate_duration_seconds').type).toBe('histogram');
    expect(parsed.value('adgate_process_uptime_seconds')).toBeGreaterThanOrEqual(0);
  });

  it('refuses a request with no token and one with the wrong token', async () => {
    const { scrape } = build();
    for (const token of [null, 'wrong-token', `${TOKEN}x`, TOKEN.slice(0, -1), '']) {
      const res = await scrape(token);
      expect(res.status, String(token)).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Bearer');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = ErrorResponse.parse(await res.json());
      expect(body.error).toEqual({
        code: 'unauthorized',
        message: METRICS_UNAUTHORIZED_MESSAGE,
      });
    }
  });

  it('does not exist when METRICS_TOKEN is unset', async () => {
    const { lines, stream } = collectLogs();
    const app = createApp({
      logger: createLogger({ level: 'info' }, stream),
      corsAllowedOrigins: [],
    });
    const res = await app.request(METRICS_PATH, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(404);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe('not_found');
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('never logs or renders the token itself', async () => {
    const { scrape, lines } = build();
    await scrape('wrong-token');
    const body = await (await scrape()).text();
    expect(body).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).toContain('metrics scrape rejected');
  });

  it('records into the registry it was given', async () => {
    const registry = createMetricsRegistry();
    const { app, scrape } = build({ metrics: registry });
    await app.request('/healthz');
    const parsed = parseExposition(await (await scrape()).text());
    expect(parsed.value('adgate_http_requests_total', { route: '/healthz', status: '200' })).toBe(
      1,
    );
    expect(
      parseExposition(registry.render()).value('adgate_http_requests_total', {
        route: '/healthz',
        status: '200',
      }),
    ).toBe(1);
  });
});

describe('http metrics middleware', () => {
  it('counts route patterns and statuses, including responses no route produced', async () => {
    const { app, scrape } = build();
    await app.request('/healthz');
    await app.request('/healthz');
    await app.request('/nope');
    await app.request('/v1/audit/aud_01H0000000000000000000');
    const parsed = parseExposition(await (await scrape()).text());
    expect(parsed.value('adgate_http_requests_total', { route: '/healthz', status: '200' })).toBe(
      2,
    );
    expect(parsed.value('adgate_http_requests_total', { route: 'other', status: '404' })).toBe(1);
    // The route pattern, never the id: /v1/audit/:id is one series whatever id is asked for.
    expect(
      parsed.value('adgate_http_requests_total', { route: '/v1/audit/:id', status: '404' }),
    ).toBe(1);
  });

  it('counts a 429 as a rate limited request and an attest by its outcome', async () => {
    const { app, scrape } = build();
    app.get('/limited', () => {
      throw new HTTPException(429, { message: 'nope' });
    });
    app.post('/v1/attest', () => {
      throw new HTTPException(409, { message: 'already' });
    });
    await app.request('/limited');
    await app.request('/v1/attest', { method: 'POST' });
    const parsed = parseExposition(await (await scrape()).text());
    expect(parsed.value('adgate_rate_limited_total')).toBe(1);
    expect(parsed.value('adgate_attest_total', { result: 'already_attested' })).toBe(1);
    expect(parsed.value('adgate_http_requests_total', { route: '/v1/attest', status: '409' })).toBe(
      1,
    );
  });
});

describe('tokenMatches', () => {
  it('accepts only the exact token', () => {
    expect(tokenMatches('secret', 'secret')).toBe(true);
    expect(tokenMatches('secre', 'secret')).toBe(false);
    expect(tokenMatches('secrets', 'secret')).toBe(false);
    expect(tokenMatches('Secret', 'secret')).toBe(false);
    expect(tokenMatches(undefined, 'secret')).toBe(false);
  });
});

describe('bearerToken', () => {
  it('reads the token of a bearer header and nothing else', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Bearer  abc ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken('abc')).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});
