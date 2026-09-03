import { AuditRecord, type PolicyDecision, type SuppressReason } from '@adgate/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { creatives } from '../db/schema.js';
import {
  auditRow,
  createHarness,
  evaluateBody,
  type EvaluateRequestInput,
  expectChecks,
  type Harness,
  TEXT,
  verifyRow,
} from './test-support.js';

/** Every documented suppress reason, each with a verifiable record of its own. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

const failingRule = (decisions: readonly PolicyDecision[]): string | undefined =>
  decisions.find((decision) => decision.result === 'fail')?.rule;

interface SuppressCase {
  reason: SuppressReason;
  body: Partial<EvaluateRequestInput> & { content?: string };
  rule: string;
  requested: string[];
}

const CASES: SuppressCase[] = [
  {
    reason: 'paid_user',
    body: { user: { tier: 'paid', region: 'US' } },
    rule: 'serve_to_tiers',
    requested: [],
  },
  {
    reason: 'region_blocked',
    body: { user: { tier: 'free', region: 'BR' } },
    rule: 'regions',
    requested: [],
  },
  {
    reason: 'sensitive_category:health',
    body: { content: TEXT.health },
    rule: 'blocked_categories',
    requested: [],
  },
  {
    reason: 'low_confidence',
    body: { content: TEXT.lowConfidence },
    rule: 'min_confidence',
    requested: [],
  },
  {
    reason: 'low_commercial_intent',
    body: { content: TEXT.lowIntent },
    rule: 'min_commercial_intent',
    requested: [],
  },
  {
    reason: 'no_fill',
    body: {
      policy_overrides: {
        competitor_exclusions: ['exampledb.dev', 'exampledeploy.dev', 'examplelang.app'],
      },
    },
    rule: 'none',
    requested: ['direct', 'affiliate'],
  },
];

describe('POST /v1/evaluate suppress reasons', () => {
  it.each(CASES)('$reason', async ({ reason, body, rule, requested }) => {
    const res = await h.evaluate(evaluateBody(h.appId, body));
    expect(res.decision).toBe('suppress');
    expect(res.reason).toBe(reason);
    expect(res.creative).toBeNull();
    expect(res.audit_id).toMatch(/^aud_/);

    const row = await auditRow(h.handle, res.audit_id);
    expect(row.decision).toBe('suppress');
    expect(row.reason).toBe(reason);
    expect(row.creativeId).toBeNull();
    const record = AuditRecord.parse(row.record);
    expect(record.reason).toBe(reason);
    expect(record.creative).toBeNull();
    expect(record.classification).toEqual(res.classification);
    expect(failingRule(record.policy_decisions) ?? 'none').toBe(rule);
    expect(record.demand.requested).toEqual(requested);
    expect(record.demand.selected).toBeNull();
    // A suppress record needs no attestation to be valid.
    expectChecks(verifyRow(h, row, { prevRecord: null }));
  });

  it('frequency_cap: the second call in the same conversation (per_session 1)', async () => {
    const first = await h.evaluate(evaluateBody(h.appId));
    expect(first.decision).toBe('serve');
    const second = await h.evaluate(evaluateBody(h.appId, { turn_id: 'turn_2' }));
    expect(second.decision).toBe('suppress');
    expect(second.reason).toBe('frequency_cap');
    expect(second.creative).toBeNull();
    const record = AuditRecord.parse((await auditRow(h.handle, second.audit_id)).record);
    expect(record.policy_decisions[5]).toEqual({
      rule: 'frequency_caps',
      result: 'fail',
      detail: 'session=1/1 day=n/a turns_since=0',
    });
    expect(record.demand.requested).toEqual([]);
    // Another conversation of the same app is not capped.
    const other = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_2' }));
    expect(other.decision).toBe('serve');
  });

  it('frequency_cap: per_user_per_day lowered by an override spans conversations', async () => {
    const user = { tier: 'free', region: 'US', user_hash: `sha256:${'b'.repeat(64)}` };
    const overrides = { frequency_caps: { per_user_per_day: 1 } };
    const first = await h.evaluate(evaluateBody(h.appId, { user, policy_overrides: overrides }));
    expect(first.decision).toBe('serve');
    const second = await h.evaluate(
      evaluateBody(h.appId, { conversation_id: 'conv_2', user, policy_overrides: overrides }),
    );
    expect(second.reason).toBe('frequency_cap');
    const record = AuditRecord.parse((await auditRow(h.handle, second.audit_id)).record);
    expect(record.policy_decisions[5]?.detail).toBe('session=0/1 day=1/1 turns_since=none');
  });

  it('no_fill with an empty catalog still lists the requested sources', async () => {
    await h.handle.db.update(creatives).set({ active: false });
    try {
      const res = await h.evaluate(evaluateBody(h.appId));
      expect(res.reason).toBe('no_fill');
      const record = AuditRecord.parse((await auditRow(h.handle, res.audit_id)).record);
      expect(record.demand.requested).toEqual(['direct', 'affiliate']);
      expect(record.demand.responses.map((r) => r.candidates)).toEqual([0, 0]);
      expect(record.demand.excluded).toEqual([]);
    } finally {
      await h.handle.db.update(creatives).set({ active: true });
    }
  });

  it('a missing region fails closed as region_blocked', async () => {
    const res = await h.evaluate(evaluateBody(h.appId, { user: { tier: 'free' } }));
    expect(res.reason).toBe('region_blocked');
  });
});
