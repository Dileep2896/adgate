import { conversationIdHash } from '@adgate/core';
import { AuditRecord } from '@adgate/schemas';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { apps, capState, userDayCaps } from '../db/schema.js';
import {
  auditRow,
  createHarness,
  evaluateBody,
  expectChecks,
  fixtureText,
  type Harness,
  PUBLIC_BASE_URL,
  storedCreativeHash,
  TEXT,
  verifyRow,
} from './test-support.js';

/** The serve path of POST /v1/evaluate with the example catalog and no LLM (rules only). */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

describe('POST /v1/evaluate serve path', () => {
  it('serves Example DB Cloud on c001 by rules alone, with a click URL and a genesis record', async () => {
    const started = Date.now();
    const res = await h.evaluate(evaluateBody(h.appId));
    const wall = Date.now() - started;

    expect(res.decision).toBe('serve');
    expect(res.reason).toBeNull();
    expect(res.classification.method).toBe('rules');
    expect(res.classification.categories[0]).toBe('software.devtools.database');
    expect(res.classification.sensitive).toEqual([]);
    expect(res.creative).toMatchObject({
      advertiser: 'Example DB Cloud',
      headline: 'Managed Postgres with a free tier',
      body: 'Spin up a database in 30 seconds. No credit card.',
      cta: 'Try it free',
      source: 'direct',
      disclosure_label: 'Sponsored',
    });
    expect(res.creative?.id).toMatch(/^cr_/);
    expect(res.creative?.url).toBe(`${PUBLIC_BASE_URL}/c/${res.audit_id}`);
    expect(res.audit_id).toMatch(/^aud_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(Number.isInteger(res.latency_ms)).toBe(true);
    expect(res.latency_ms).toBeLessThanOrEqual(wall + 5);
    expect(wall).toBeLessThan(700);

    const row = await auditRow(h.handle, res.audit_id);
    expect(row.seq).toBe(1);
    expect(row.prevHash).toBe('genesis');
    expect(row.isLatest).toBe(true);
    expect(row.supersedesHash).toBeNull();
    expect(row.decision).toBe('serve');
    expect(row.reason).toBeNull();
    expect(row.creativeId).toBe(res.creative?.id);
    expect(row.advertiserId).toMatch(/^adv_/);
    expect(row.ts.toISOString()).toBe(row.record.ts);

    const record = AuditRecord.parse(row.record);
    expect(record.id).toBe(res.audit_id);
    expect(record.app_id).toBe(h.appId);
    expect(record.turn_id).toBe('turn_1');
    expect(record.conversation_id_hash).toBe(conversationIdHash(h.registered.app.salt, 'conv_1'));
    expect(record.user_hash).toBeNull();
    expect(record.surface).toEqual({ type: 'chat', placement: 'after_answer' });
    expect(record.classification).toEqual(res.classification);
    expect(record.policy_version).toBe(1);
    expect(record.policy_hash).toBe(h.registered.app.policyHash);
    expect(record.policy_decisions.map((d) => d.result)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pending',
    ]);
    expect(record.policy_decisions[5]?.detail).toBe('session=0/1 day=n/a turns_since=none');
    expect(record.override_rejected).toEqual([]);
    expect(record.demand.requested).toEqual(['direct', 'affiliate']);
    expect(record.demand.responses.map((r) => r.candidates)).toEqual([2, 0]);
    expect(record.demand.responses[1]?.error).toBe('affiliate_not_configured');
    expect(record.demand.excluded).toEqual([]);
    expect(record.demand.selected).toBe('direct');
    expect(record.creative?.advertiser_domain).toBe('exampledb.dev');
    expect(record.disclosure).toEqual({
      label: 'Sponsored',
      position: 'after_answer',
      style: 'separate_block',
    });
    expect(record.separation_attestation).toBe(false);
    expect(record.key_id).toBe('k_test');

    const stored = await storedCreativeHash(h.handle, record.creative?.id ?? '');
    expect(record.creative?.content_hash).toBe(stored);
    const result = verifyRow(h, row, { prevRecord: null, storedCreativeHash: stored });
    // An unattested serve record fails only separation_attested (docs: true only if attested).
    expectChecks(result, ['separation_attested']);
    expect(result.checks.find((c) => c.name === 'chain')?.detail).toBe('genesis');
    expect(result.checks.find((c) => c.name === 'signature')?.detail).toBe('key_id=k_test');
  });

  it('counts the turn and the served ad in cap_state and, with a user_hash, in user_day_caps', async () => {
    const userHash = `sha256:${'a'.repeat(64)}`;
    const res = await h.evaluate(
      evaluateBody(h.appId, { user: { tier: 'free', region: 'US', user_hash: userHash } }),
    );
    expect(res.decision).toBe('serve');
    const [caps] = await h.handle.db.select().from(capState).where(eq(capState.appId, h.appId));
    expect(caps).toMatchObject({
      conversationHash: conversationIdHash(h.registered.app.salt, 'conv_1'),
      userHash,
      sessionCount: 1,
      turnCount: 1,
      lastTurnIndex: 1,
    });
    const [day] = await h.handle.db
      .select()
      .from(userDayCaps)
      .where(eq(userDayCaps.appId, h.appId));
    expect(day).toMatchObject({ userHash, count: 1 });
    expect(day?.day).toBe(new Date().toISOString().slice(0, 10));
    const record = AuditRecord.parse((await auditRow(h.handle, res.audit_id)).record);
    expect(record.user_hash).toBe(userHash);
    expect(record.policy_decisions[5]?.detail).toBe('session=0/1 day=0/3 turns_since=none');
  });

  it('serves an affiliate creative through the owner’s configured network', async () => {
    await h.handle.db
      .update(apps)
      .set({ affiliateConfig: { partnerstack: { program_id: 'ps_owner_1' } } })
      .where(eq(apps.id, h.appId));
    const res = await h.evaluate(evaluateBody(h.appId, { content: fixtureText('c019') }));
    await h.handle.db.update(apps).set({ affiliateConfig: null }).where(eq(apps.id, h.appId));

    expect(res.decision).toBe('serve');
    expect(res.creative).toMatchObject({
      advertiser: 'Example Language App',
      source: 'affiliate',
      url: `${PUBLIC_BASE_URL}/c/${res.audit_id}`,
    });
    const record = AuditRecord.parse((await auditRow(h.handle, res.audit_id)).record);
    expect(record.demand.selected).toBe('affiliate');
    expect(record.demand.responses[1]).toMatchObject({ source: 'affiliate', candidates: 1 });
    expect(record.demand.responses[1]?.error).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('ps_owner_1');
  });

  it('writes one evaluate log line with ids and enums, never the messages or the key', async () => {
    const res = await h.evaluate(evaluateBody(h.appId));
    const line = h.lines.find((entry) => entry.includes('"msg":"evaluate"'));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line ?? '{}') as Record<string, unknown>;
    expect(parsed).toMatchObject({
      app_id: h.appId,
      audit_id: res.audit_id,
      decision: 'serve',
      reason: null,
      classification_method: 'rules',
      classify_source: 'rules_fallback',
      cache_source: 'miss',
      persisted: true,
      seq: 1,
    });
    expect(typeof parsed['req_id']).toBe('string');
    expect(typeof parsed['latency_ms']).toBe('number');
    for (const entry of h.lines) {
      expect(entry).not.toContain(TEXT.serve);
      expect(entry).not.toContain('postgres hosting');
      expect(entry).not.toContain(h.apiKey);
      expect(entry).not.toContain(h.registered.key.secret);
    }
  });

  it('classifies context_summary when the app sends no messages', async () => {
    const res = await h.evaluate(
      evaluateBody(h.appId, { messages: [], context_summary: TEXT.serve }),
    );
    expect(res.decision).toBe('serve');
  });
});
