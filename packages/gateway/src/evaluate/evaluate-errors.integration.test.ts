import { FakeLlmClassifier, fakeLlmFromFixtures, fakeLlmSuccess } from '@adgate/core';
import { AuditRecord, ErrorResponse, EvaluateResponse } from '@adgate/schemas';
import { count } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditRecords, classifyCache } from '../db/schema.js';
import { registerApp } from '../apps/register-app.js';
import type { AuditStore } from './audit-store.js';
import {
  auditRow,
  auditRowsInOrder,
  createHarness,
  evaluateBody,
  expectChecks,
  fixtureCases,
  type Harness,
  verifyRow,
} from './test-support.js';

/** The HTTP boundary (400/401/403), the fail-closed path, and the LLM plus cache path. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

describe('POST /v1/evaluate rejects', () => {
  it('a body that is not JSON with 400 invalid_request', async () => {
    const res = await h.post(null, { raw: '{not json' });
    expect(res.status).toBe(400);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe('invalid_request');
  });

  it('a body that is not an EvaluateRequest with 400 invalid_request naming the path', async () => {
    // JSON.stringify drops the undefined key, so the body arrives without a surface.
    const res = await h.post({ ...evaluateBody(h.appId), surface: undefined });
    expect(res.status).toBe(400);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toContain('surface');
    expect(await h.handle.db.select({ n: count() }).from(auditRecords)).toEqual([{ n: 0 }]);
  });

  it('an app_id that is not the key’s with 403 forbidden', async () => {
    const other = await registerApp(h.handle.db, { name: 'Other App' });
    const res = await h.post(evaluateBody(other.app.id));
    expect(res.status).toBe(403);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe('forbidden');
  });

  it('a missing or wrong key with 401 before reading the body', async () => {
    const missing = await h.post(evaluateBody(h.appId), { apiKey: null });
    expect(missing.status).toBe(401);
    expect(ErrorResponse.parse(await missing.json()).error.code).toBe('unauthorized');
    const wrong = await h.post(evaluateBody(h.appId), {
      apiKey: 'ak_ZZZZZZZZZZZZ_' + 'x'.repeat(43),
    });
    expect(wrong.status).toBe(401);
  });
});

describe('POST /v1/evaluate fails closed', () => {
  it('answers HTTP 200 suppress/error when the audit record cannot be persisted', async () => {
    const failing: AuditStore = {
      persist: async () => {
        throw new Error('connection refused: secret-detail');
      },
    };
    const broken = await createHarness({ overrides: { auditStore: failing } });
    try {
      const res = await broken.post(evaluateBody(broken.appId));
      expect(res.status).toBe(200);
      const body = EvaluateResponse.parse(await res.json());
      expect(body.decision).toBe('suppress');
      expect(body.reason).toBe('error');
      expect(body.creative).toBeNull();
      expect(body.audit_id).toMatch(/^aud_/);
      expect(body.classification.confidence).toBe(0);
      expect(await broken.handle.db.select({ n: count() }).from(auditRecords)).toEqual([{ n: 0 }]);
      const errors = broken.lines.filter((line) => line.includes('"level":50'));
      expect(errors.length).toBeGreaterThanOrEqual(2);
      expect(errors.some((line) => line.includes('"error_name":"Error"'))).toBe(true);
      expect(errors.some((line) => line.includes(body.audit_id))).toBe(true);
      for (const line of broken.lines) {
        expect(line).not.toContain('secret-detail');
        expect(line).not.toContain('postgres hosting');
      }
    } finally {
      await broken.close();
      h = await createHarness();
    }
  });

  it('writes a fail-closed record when a step before persistence throws', async () => {
    const exploding = await createHarness({
      overrides: {
        adapters: {
          build: async () => {
            throw new TypeError('adapter factory exploded');
          },
        },
      },
    });
    try {
      const res = await exploding.evaluate(evaluateBody(exploding.appId));
      expect(res.reason).toBe('error');
      const row = await auditRow(exploding.handle, res.audit_id);
      expect(row.seq).toBe(1);
      const record = AuditRecord.parse(row.record);
      expect(record.reason).toBe('error');
      expect(record.classification.confidence).toBe(0);
      expect(record.policy_decisions).toEqual([]);
      expect(record.demand.requested).toEqual([]);
      expectChecks(verifyRow(exploding, row, { prevRecord: null }));
      expect(exploding.lines.some((l) => l.includes('"error_name":"TypeError"'))).toBe(true);
    } finally {
      await exploding.close();
      h = await createHarness();
    }
  });
});

describe('POST /v1/evaluate with an LLM', () => {
  it('classifies with the LLM once, then from the cache, with one classify_cache row', async () => {
    const llm = new FakeLlmClassifier(fakeLlmFromFixtures(fixtureCases));
    const withLlm = await createHarness({ overrides: { llm } });
    try {
      const first = await withLlm.evaluate(evaluateBody(withLlm.appId, { conversation_id: 'c1' }));
      expect(first.decision).toBe('serve');
      expect(first.classification.method).toBe('llm');
      expect(first.classification.categories).toEqual(['software.devtools.database']);
      expect(llm.callCount).toBe(1);

      const second = await withLlm.evaluate(evaluateBody(withLlm.appId, { conversation_id: 'c2' }));
      expect(second.decision).toBe('serve');
      expect(second.classification.method).toBe('cached');
      expect(llm.callCount).toBe(1);
      expect(await withLlm.handle.db.select({ n: count() }).from(classifyCache)).toEqual([
        { n: 1 },
      ]);

      // A fresh process (empty LRU) is served by the Postgres tier.
      withLlm.deps.classifyCache.clear();
      const third = await withLlm.evaluate(evaluateBody(withLlm.appId, { conversation_id: 'c3' }));
      expect(third.classification.method).toBe('cached');
      expect(llm.callCount).toBe(1);
      const sources = withLlm.lines
        .filter((line) => line.includes('"msg":"evaluate"'))
        .map((line) => (JSON.parse(line) as { cache_source: string }).cache_source);
      expect(sources).toEqual(['miss', 'lru', 'pg']);
      expect(llm.calls.every((text) => text.startsWith('user: '))).toBe(true);
      expect((await auditRowsInOrder(withLlm.handle, withLlm.appId)).map((r) => r.seq)).toEqual([
        1, 2, 3,
      ]);
    } finally {
      await withLlm.close();
      h = await createHarness();
    }
  });

  it('suppresses with low_confidence when the merged confidence is under the threshold', async () => {
    const llm = new FakeLlmClassifier(
      fakeLlmSuccess({
        commercial_intent: 0.84,
        categories: ['software.devtools.database'],
        confidence: 0.3,
      }),
    );
    const withLlm = await createHarness({ overrides: { llm } });
    try {
      const res = await withLlm.evaluate(evaluateBody(withLlm.appId));
      expect(res.reason).toBe('low_confidence');
      expect(res.classification.method).toBe('llm');
      expect(res.classification.confidence).toBe(0.3);
    } finally {
      await withLlm.close();
      h = await createHarness();
    }
  });

  it('falls back to rules when the LLM hangs past the classifier timeout', async () => {
    const withLlm = await createHarness({
      overrides: { llm: new FakeLlmClassifier('hang'), classifierTimeoutMs: 50 },
    });
    try {
      const res = await withLlm.evaluate(evaluateBody(withLlm.appId));
      expect(res.decision).toBe('serve');
      expect(res.classification.method).toBe('rules');
      const line = withLlm.lines.find((entry) => entry.includes('"msg":"evaluate"')) ?? '{}';
      expect(JSON.parse(line)).toMatchObject({
        classify_source: 'rules_fallback',
        llm_failure: 'timeout',
      });
    } finally {
      await withLlm.close();
      h = await createHarness();
    }
  });
});
