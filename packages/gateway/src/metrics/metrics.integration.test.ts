import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, evaluateBody, type Harness, TEXT } from '../evaluate/test-support.js';
import { METRICS_PATH } from './instrument.js';
import { type Exposition, parseExposition } from './test-support.js';

/**
 * The metrics of real evaluations: the same Hono app, database, catalog and signing keys every
 * other integration test uses, scraped over HTTP and parsed back. Counters are process-wide and
 * this file shares one app, so every assertion is a DELTA around the requests it made.
 */
const TOKEN = 'metrics-integration-token';

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ metricsToken: TOKEN });
});

beforeEach(() => h.reset());

afterAll(() => h.close());

const scrapeBody = async (token: string = TOKEN): Promise<Response> =>
  h.app.request(METRICS_PATH, { headers: { authorization: `Bearer ${token}` } });

const scrape = async (): Promise<Exposition> => {
  const res = await scrapeBody();
  expect(res.status).toBe(200);
  return parseExposition(await res.text());
};

const delta = (
  before: Exposition,
  after: Exposition,
  name: string,
  labels: Record<string, string> = {},
): number => (after.value(name, labels) ?? 0) - (before.value(name, labels) ?? 0);

describe('GET /metrics over the evaluate path', () => {
  it('counts one serve and one suppress with their reasons', async () => {
    const before = await scrape();

    const serve = await h.evaluate(evaluateBody(h.appId));
    expect(serve.decision).toBe('serve');
    const suppress = await h.evaluate(
      evaluateBody(h.appId, {
        conversation_id: 'conv_paid',
        user: { tier: 'paid', region: 'US' },
      }),
    );
    expect(suppress.decision).toBe('suppress');
    expect(suppress.reason).toBe('paid_user');

    const after = await scrape();
    expect(
      delta(before, after, 'adgate_decisions_total', { decision: 'serve', reason: 'none' }),
    ).toBe(1);
    expect(
      delta(before, after, 'adgate_decisions_total', {
        decision: 'suppress',
        reason: 'paid_user',
      }),
    ).toBe(1);
    expect(delta(before, after, 'adgate_evaluate_duration_seconds_count')).toBe(2);
    expect(delta(before, after, 'adgate_evaluate_duration_seconds_sum')).toBeGreaterThan(0);
    expect(
      delta(before, after, 'adgate_http_requests_total', { route: '/v1/evaluate', status: '200' }),
    ).toBe(2);
  });

  it('records a serve inside the documented latency budget', async () => {
    const before = await scrape();
    await h.evaluate(evaluateBody(h.appId));
    const after = await scrape();
    // docs/api.md: p95 under 700 ms cold. One local evaluation must be inside the last bucket.
    expect(delta(before, after, 'adgate_evaluate_duration_seconds_bucket', { le: '1' })).toBe(1);
  });

  it('times every demand adapter the mediation queried, by source', async () => {
    const before = await scrape();
    const serve = await h.evaluate(evaluateBody(h.appId));
    expect(serve.decision).toBe('serve');
    const after = await scrape();

    // The default policy queries direct then affiliate; both answer, so both are timed.
    for (const source of ['direct', 'affiliate']) {
      expect(
        delta(before, after, 'adgate_demand_adapter_duration_seconds_count', { source }),
        source,
      ).toBe(1);
    }
    expect(
      delta(before, after, 'adgate_demand_adapter_duration_seconds_bucket', {
        source: 'direct',
        le: '+Inf',
      }),
    ).toBe(1);
  });

  it('counts a classifier cache miss and then a hit for the same text', async () => {
    const before = await scrape();
    // A rules-only classification is deliberately NOT cached (core classify.ts), so the text
    // that exercises the cache here is one the rules short-circuit on: that result IS stored,
    // and the second turn with the same text and policy reads it out of the in-process tier.
    await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_a', content: TEXT.health }));
    await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_b', content: TEXT.health }));
    const after = await scrape();

    expect(delta(before, after, 'adgate_classify_cache_total', { result: 'miss' })).toBe(1);
    expect(delta(before, after, 'adgate_classify_cache_total', { result: 'hit_memory' })).toBe(1);
  });

  it('suppresses without asking demand, and records no adapter for that turn', async () => {
    const before = await scrape();
    const suppressed = await h.evaluate(
      evaluateBody(h.appId, { conversation_id: 'conv_health', content: TEXT.health }),
    );
    expect(suppressed.reason).toBe('sensitive_category:health');
    const after = await scrape();
    expect(
      delta(before, after, 'adgate_demand_adapter_duration_seconds_count', { source: 'direct' }),
    ).toBe(0);
    expect(
      delta(before, after, 'adgate_decisions_total', {
        decision: 'suppress',
        reason: 'sensitive_category:health',
      }),
    ).toBe(1);
  });

  it('answers 401 without a token and 200 with it', async () => {
    const anonymous = await h.app.request(METRICS_PATH);
    expect(anonymous.status).toBe(401);
    const wrong = await scrapeBody('not-the-token');
    expect(wrong.status).toBe(401);
    const ok = await scrapeBody();
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
  });

  it('carries no app, audit, conversation or hash value in any label', async () => {
    const response = await h.evaluate(evaluateBody(h.appId));
    const auditRes = await h.app.request(`/v1/audit/${response.audit_id}`, {
      headers: { authorization: `Bearer ${h.apiKey}` },
    });
    expect(auditRes.status).toBe(200);
    const body = await (await scrapeBody()).text();

    for (const value of parseExposition(body).labelValues()) {
      expect(value, value).not.toMatch(/^(app_|aud_|cr_|ev_|key_|adv_|conv_)/);
      expect(value, value).not.toMatch(/^[0-9a-f]{64}$/);
      expect(value, value).not.toContain('sha256:');
    }
    expect(body).not.toContain(h.appId);
    expect(body).not.toContain(response.audit_id);
    expect(body).not.toContain(response.creative?.id ?? 'no-creative');
    expect(body).not.toContain('conv_');
  });
});
