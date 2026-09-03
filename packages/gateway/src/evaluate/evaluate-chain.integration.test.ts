import { mergeOverrides, policyHash } from '@adgate/core';
import { AuditRecord } from '@adgate/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  auditRow,
  auditRowsInOrder,
  createHarness,
  evaluateBody,
  expectChecks,
  type Harness,
  storedCreativeHash,
  TEXT,
  verifyRow,
} from './test-support.js';

/** The per-app hash chain and the stricter-only policy overrides. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

describe('POST /v1/evaluate chain', () => {
  it('links three records with seq 1, 2, 3 and each verifies against its predecessor', async () => {
    const first = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_a' }));
    const second = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_b' }));
    const third = await h.evaluate(
      evaluateBody(h.appId, { conversation_id: 'conv_c', content: TEXT.health }),
    );
    expect([first.decision, second.decision, third.decision]).toEqual([
      'serve',
      'serve',
      'suppress',
    ]);

    const rows = await auditRowsInOrder(h.handle, h.appId);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.id)).toEqual([first.audit_id, second.audit_id, third.audit_id]);
    expect(rows[0]?.prevHash).toBe('genesis');
    expect(rows[1]?.prevHash).toBe(rows[0]?.recordHash);
    expect(rows[2]?.prevHash).toBe(rows[1]?.recordHash);
    expect(rows.every((row) => row.isLatest)).toBe(true);
    const [r1, r2, r3] = rows.map((row) => AuditRecord.parse(row.record));
    expect(r2?.prev_hash).toBe(r1?.record_hash);
    expect(r3?.prev_hash).toBe(r2?.record_hash);

    const hash1 = await storedCreativeHash(h.handle, r1?.creative?.id ?? '');
    const hash2 = await storedCreativeHash(h.handle, r2?.creative?.id ?? '');
    expectChecks(verifyRow(h, rows[0]!, { prevRecord: null, storedCreativeHash: hash1 }), [
      'separation_attested',
    ]);
    expectChecks(verifyRow(h, rows[1]!, { prevRecord: r1, storedCreativeHash: hash2 }), [
      'separation_attested',
    ]);
    expectChecks(verifyRow(h, rows[2]!, { prevRecord: r2 }));

    // The positional predecessor is what counts: record 3 against record 1 is a broken chain.
    const forked = verifyRow(h, rows[2]!, { prevRecord: r1 });
    expect(forked.valid).toBe(false);
    expect(forked.checks.find((c) => c.name === 'chain')).toMatchObject({ ok: false });
  });

  it('records every evaluation, error path included, at the next seq', async () => {
    await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_a' }));
    await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_a', turn_id: 'turn_2' }));
    const rows = await auditRowsInOrder(h.handle, h.appId);
    expect(rows.map((row) => [row.seq, row.reason])).toEqual([
      [1, null],
      [2, 'frequency_cap'],
    ]);
  });
});

describe('POST /v1/evaluate policy overrides', () => {
  it('ignores loosening overrides and lists them as override_rejected with their paths', async () => {
    const res = await h.evaluate(
      evaluateBody(h.appId, {
        content: TEXT.health,
        user: { tier: 'paid', region: 'US' },
        policy_overrides: {
          allow_paid_tiers: true,
          serve_to_tiers: ['free', 'paid'],
          blocked_categories: ['self_harm'],
          frequency_caps: { per_session: 5 },
          min_confidence: 0.1,
          privacy: { store_raw_text: true },
        },
      }),
    );
    // Still the stored policy: a paid user is suppressed first, health stays blocked.
    expect(res.reason).toBe('paid_user');
    const record = AuditRecord.parse((await auditRow(h.handle, res.audit_id)).record);
    expect(record.override_rejected.map((r) => r.path).sort()).toEqual([
      'allow_paid_tiers',
      'frequency_caps.per_session',
      'min_confidence',
      'privacy.store_raw_text',
      'serve_to_tiers',
    ]);
    expect(record.policy_decisions[2]?.result).toBe('fail');
    expect(record.policy_decisions[2]?.detail).toBe('health in sensitive');
    // Nothing accepted: the record pins the stored policy's hash.
    expect(record.policy_hash).toBe(h.registered.app.policyHash);
    expectChecks(verifyRow(h, await auditRow(h.handle, res.audit_id), { prevRecord: null }));
  });

  it('applies a tightening override: a competitor exclusion excludes the winner and pins a new policy hash', async () => {
    const policy_overrides = { competitor_exclusions: ['exampledb.dev'] };
    const res = await h.evaluate(evaluateBody(h.appId, { policy_overrides }));
    expect(res.decision).toBe('serve');
    expect(res.creative?.advertiser).toBe('Example Deploy');
    const record = AuditRecord.parse((await auditRow(h.handle, res.audit_id)).record);
    expect(record.override_rejected).toEqual([]);
    expect(record.demand.excluded).toEqual([
      {
        source: 'direct',
        creative_id: expect.stringMatching(/^cr_/) as string,
        advertiser_domain: 'exampledb.dev',
        reason: 'competitor_exclusion',
      },
    ]);
    expect(record.demand.responses[0]?.candidates).toBe(2);
    const expected = policyHash(mergeOverrides(h.registered.policy, policy_overrides).policy);
    expect(record.policy_hash).toBe(expected);
    expect(record.policy_hash).not.toBe(h.registered.app.policyHash);
  });

  it('excluding every advertiser ends in no_fill with the exclusions in the trace', async () => {
    const res = await h.evaluate(
      evaluateBody(h.appId, {
        policy_overrides: { competitor_exclusions: ['*.exampledb.dev', 'exampledeploy.dev'] },
      }),
    );
    expect(res.reason).toBe('no_fill');
    const record = AuditRecord.parse((await auditRow(h.handle, res.audit_id)).record);
    expect(record.demand.excluded.map((e) => e.advertiser_domain).sort()).toEqual([
      'exampledb.dev',
      'exampledeploy.dev',
    ]);
    expect(record.demand.selected).toBeNull();
    expect(record.policy_decisions[6]).toEqual({
      rule: 'competitor_exclusions',
      result: 'pending',
    });
  });

  it('disabling a demand source through an override drops it from the requested list', async () => {
    const res = await h.evaluate(
      evaluateBody(h.appId, {
        policy_overrides: { demand: [{ source: 'affiliate', enabled: false }] },
      }),
    );
    expect(res.decision).toBe('serve');
    const record = AuditRecord.parse((await auditRow(h.handle, res.audit_id)).record);
    expect(record.demand.requested).toEqual(['direct']);
  });
});
