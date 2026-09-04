import { ErrorResponse } from '@adgate/schemas';
import { count } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { issueApiKey } from '../auth/repository.js';
import { auditRecords, rateLimits } from '../db/schema.js';
import {
  createHarness,
  evaluateBody,
  type Harness,
  type HarnessOptions,
  withHarness,
} from '../evaluate/test-support.js';
import { postJson } from '../test-support/routes.js';
import { RATE_LIMITED_MESSAGE, REMAINING_HEADER, RETRY_AFTER_HEADER } from './middleware.js';
import { createFailingRateLimiter } from './test-support.js';

/**
 * The per-key token bucket on the real write routes: RATE_LIMIT_RPS 5, RATE_LIMIT_BURST 3,
 * under a clock the test moves by hand (the harness clock feeds both the pipeline and the
 * limiter).
 */
const T0 = Date.parse('2026-09-03T12:00:00Z');
let now = T0;
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ rateLimit: { rps: 5, burst: 3 }, overrides: { now: () => now } });
});

beforeEach(async () => {
  now = T0;
  await h.reset();
});

afterAll(() => h.close());

const isolated = async (
  options: HarnessOptions,
  fn: (harness: Harness) => Promise<void>,
): Promise<void> => {
  await h.close();
  try {
    await withHarness(options, fn);
  } finally {
    h = await createHarness({ rateLimit: { rps: 5, burst: 3 }, overrides: { now: () => now } });
  }
};

/** One evaluate in a conversation of its own, so per_session caps never interfere. */
const evaluateOnce = (harness: Harness, index: number, apiKey?: string) =>
  harness.post(evaluateBody(harness.appId, { conversation_id: `conv_${index}` }), { apiKey });

const auditCount = async (harness: Harness) =>
  (await harness.handle.db.select({ n: count() }).from(auditRecords))[0]?.n;

describe('rate limiting on POST /v1/evaluate', () => {
  it('passes burst requests, answers 429 with Retry-After and the docs body, then refills', async () => {
    for (const expected of ['2', '1', '0']) {
      const res = await evaluateOnce(h, Number(expected));
      expect(res.status).toBe(200);
      expect(res.headers.get(REMAINING_HEADER)).toBe(expected);
    }
    const refused = await evaluateOnce(h, 3);
    expect(refused.status).toBe(429);
    expect(refused.headers.get(RETRY_AFTER_HEADER)).toBe('1');
    expect(refused.headers.get(REMAINING_HEADER)).toBe('0');
    expect(ErrorResponse.parse(await refused.json())).toEqual({
      error: { code: 'rate_limited', message: RATE_LIMITED_MESSAGE },
    });
    // The refused turn never reached the pipeline: no record, no counted turn.
    expect(await auditCount(h)).toBe(3);
    const line = h.lines.find((l) => l.includes('"msg":"rate limited"'));
    expect(JSON.parse(line ?? '{}')).toMatchObject({ status: 429, retry_after_s: 1 });

    now += 1_000; // 5 tokens at 5 rps, capped at the burst of 3.
    for (let index = 4; index < 7; index += 1) {
      expect((await evaluateOnce(h, index)).status).toBe(200);
    }
    expect((await evaluateOnce(h, 7)).status).toBe(429);
    expect(await auditCount(h)).toBe(6);
  });

  it('shares one bucket per key across evaluate, attest and events', async () => {
    const first = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_0' }));
    await evaluateOnce(h, 1);
    await evaluateOnce(h, 2);
    const event = { audit_id: first.audit_id, type: 'impression', ts: '2026-09-03T12:00:00Z' };
    expect((await postJson(h, '/v1/events', event)).status).toBe(429);
    const attest = {
      audit_id: first.audit_id,
      model_output_hash: `sha256:${'a'.repeat(64)}`,
      rendered: true,
    };
    expect((await postJson(h, '/v1/attest', attest)).status).toBe(429);
    now += 200; // exactly one token
    expect((await postJson(h, '/v1/events', event)).status).toBe(204);
    expect((await postJson(h, '/v1/attest', attest)).status).toBe(429);
    now += 200;
    expect((await postJson(h, '/v1/attest', attest)).status).toBe(204);
  });

  it('keeps independent buckets per API key, keyed by key id', async () => {
    const second = await issueApiKey(h.handle.db, { appId: h.appId, role: 'app' });
    for (let index = 0; index < 3; index += 1) {
      expect((await evaluateOnce(h, index)).status).toBe(200);
    }
    expect((await evaluateOnce(h, 3)).status).toBe(429);
    const other = await evaluateOnce(h, 4, second.api_key);
    expect(other.status).toBe(200);
    expect(other.headers.get(REMAINING_HEADER)).toBe('2');
    const rows = await h.handle.db.select({ keyId: rateLimits.keyId }).from(rateLimits);
    expect(rows.map((row) => row.keyId).sort()).toEqual(
      [h.registered.key.key_id, second.key_id].sort(),
    );
  });

  it('allows exactly the burst out of ten concurrent requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) => evaluateOnce(h, index)),
    );
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
    expect(await auditCount(h)).toBe(3);
  });

  it('lets evaluate through with a warn line when the limiter itself fails', async () => {
    await isolated(
      { rateLimiter: createFailingRateLimiter(new Error('pool exhausted')) },
      async (s) => {
        const res = await s.evaluate(evaluateBody(s.appId));
        expect(res.decision).toBe('serve');
        const warn = s.lines.find((l) => l.includes('rate limiter unavailable'));
        expect(JSON.parse(warn ?? '{}')).toMatchObject({ level: 40, error_name: 'Error' });
        expect(warn).not.toContain('pool exhausted');
      },
    );
  });
});
