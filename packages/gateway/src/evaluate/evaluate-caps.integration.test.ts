import { conversationIdHash } from '@adgate/core';
import { AuditRecord, type CapState } from '@adgate/schemas';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { capState, userDayCaps } from '../db/schema.js';
import {
  auditRow,
  auditRowsInOrder,
  createHarness,
  evaluateBody,
  expectChecks,
  type Harness,
  type HarnessOptions,
  storedCreativeHash,
  verifyRow,
  withHarness,
} from './test-support.js';

/** Frequency caps: the counters over a conversation and the re-check under the app lock. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

/** Runs `fn` on a harness of its own; the shared one is closed first and rebuilt after. */
const isolated = async (
  options: HarnessOptions,
  fn: (harness: Harness) => Promise<void>,
): Promise<void> => {
  await h.close();
  try {
    await withHarness(options, fn);
  } finally {
    h = await createHarness();
  }
};

const capRow = async (harness: Harness, conversationId = 'conv_1') => {
  const [row] = await harness.handle.db
    .select()
    .from(capState)
    .where(
      and(
        eq(capState.appId, harness.appId),
        eq(
          capState.conversationHash,
          conversationIdHash(harness.registered.app.salt, conversationId),
        ),
      ),
    );
  return row;
};

const capDetail = async (harness: Harness, auditId: string): Promise<string | undefined> =>
  AuditRecord.parse((await auditRow(harness.handle, auditId)).record).policy_decisions[5]?.detail;

const capsPolicy = (caps: string): string =>
  [
    'version: 1',
    'app_id: caps-app',
    'frequency_caps:',
    ...caps.split('\n').map((l) => `  ${l}`),
    '',
  ].join('\n');

describe('frequency caps under concurrency', () => {
  it('two concurrent turns of one conversation under per_session 1: exactly one serves', async () => {
    const [a, b] = await Promise.all([
      h.evaluate(evaluateBody(h.appId, { turn_id: 'turn_a' })),
      h.evaluate(evaluateBody(h.appId, { turn_id: 'turn_b' })),
    ]);
    expect([a.decision, b.decision].sort()).toEqual(['serve', 'suppress']);
    const suppressed = a.decision === 'suppress' ? a : b;
    expect(suppressed.reason).toBe('frequency_cap');
    expect(suppressed.creative).toBeNull();

    const rows = await auditRowsInOrder(h.handle, h.appId);
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
    for (const [index, row] of rows.entries()) {
      const stored =
        row.creativeId === null ? null : await storedCreativeHash(h.handle, row.creativeId);
      const result = verifyRow(h, row, {
        prevRecord: index === 0 ? null : (rows[0]?.record ?? null),
        storedCreativeHash: stored,
      });
      expectChecks(result, row.decision === 'serve' ? ['separation_attested'] : []);
    }
    expect(await capRow(h)).toMatchObject({ sessionCount: 1, turnCount: 2, lastTurnIndex: 1 });
  });

  it('re-checks the caps under the app lock when the pre-lock read was stale', async () => {
    // A reader that always reports a fresh conversation stands in for the race window.
    const stale = {
      read: async (): Promise<CapState> => ({
        session_count: 0,
        day_count: 0,
        turns_since_last: null,
      }),
    };
    await isolated({ overrides: { caps: stale } }, async (s) => {
      const first = await s.evaluate(evaluateBody(s.appId));
      expect(first.decision).toBe('serve');
      const second = await s.evaluate(evaluateBody(s.appId, { turn_id: 'turn_2' }));
      expect(second.decision).toBe('suppress');
      expect(second.reason).toBe('frequency_cap');
      expect(second.creative).toBeNull();

      const rows = await auditRowsInOrder(s.handle, s.appId);
      const record = AuditRecord.parse(rows[1]?.record);
      expect(record.reason).toBe('frequency_cap');
      expect(record.policy_decisions[5]).toEqual({
        rule: 'frequency_caps',
        result: 'fail',
        detail: 'session=1/1 day=n/a turns_since=0',
      });
      expect(record.demand).toEqual({ requested: [], responses: [], excluded: [], selected: null });
      expect(rows[1]?.advertiserId).toBeNull();
      expectChecks(
        verifyRow(s, rows[1] as NonNullable<(typeof rows)[1]>, {
          prevRecord: rows[0]?.record ?? null,
        }),
      );
      expect(await capRow(s)).toMatchObject({ sessionCount: 1, turnCount: 2, lastTurnIndex: 1 });
      const line = s.lines.find(
        (entry) => entry.includes(second.audit_id) && entry.includes('"msg":"evaluate"'),
      );
      expect(JSON.parse(line ?? '{}')).toMatchObject({
        cap_recheck: 'suppressed',
        decision: 'suppress',
      });
    });
  });
});

describe('frequency caps over a conversation', () => {
  it('per_session 3 with min_turns_between 0: three ads, then frequency_cap', async () => {
    const policyYaml = capsPolicy('per_session: 3\nper_user_per_day: 3\nmin_turns_between: 0');
    await isolated({ policyYaml }, async (s) => {
      const turns = [];
      for (const turn of [1, 2, 3, 4]) {
        turns.push(await s.evaluate(evaluateBody(s.appId, { turn_id: `turn_${turn}` })));
      }
      expect(turns.map((t) => t.decision)).toEqual(['serve', 'serve', 'serve', 'suppress']);
      expect(turns[3]?.reason).toBe('frequency_cap');
      const details = [];
      for (const turn of turns) {
        details.push(await capDetail(s, turn.audit_id));
      }
      expect(details).toEqual([
        'session=0/3 day=n/a turns_since=none',
        'session=1/3 day=n/a turns_since=0',
        'session=2/3 day=n/a turns_since=0',
        'session=3/3 day=n/a turns_since=0',
      ]);
      expect(await capRow(s)).toMatchObject({ sessionCount: 3, turnCount: 4, lastTurnIndex: 3 });
    });
  });

  it('per_session 3 with min_turns_between 1: alternates and records turns_since', async () => {
    const policyYaml = capsPolicy('per_session: 3\nper_user_per_day: 3\nmin_turns_between: 1');
    await isolated({ policyYaml }, async (s) => {
      const turns = [];
      for (const turn of [1, 2, 3, 4]) {
        turns.push(await s.evaluate(evaluateBody(s.appId, { turn_id: `turn_${turn}` })));
      }
      expect(turns.map((t) => t.decision)).toEqual(['serve', 'suppress', 'serve', 'suppress']);
      expect(turns[1]?.reason).toBe('frequency_cap');
      expect(turns[3]?.reason).toBe('frequency_cap');
      const details = [];
      for (const turn of turns) {
        details.push(await capDetail(s, turn.audit_id));
      }
      expect(details).toEqual([
        'session=0/3 day=n/a turns_since=none',
        'session=1/3 day=n/a turns_since=0',
        'session=1/3 day=n/a turns_since=1',
        'session=2/3 day=n/a turns_since=0',
      ]);
      expect(await capRow(s)).toMatchObject({ sessionCount: 2, turnCount: 4, lastTurnIndex: 3 });
    });
  });

  it('per_user_per_day 1 spans conversations through user_day_caps, per user', async () => {
    const policyYaml = capsPolicy('per_session: 1\nper_user_per_day: 1\nmin_turns_between: 0');
    await isolated({ policyYaml }, async (s) => {
      const alice = { tier: 'free', region: 'US', user_hash: `sha256:${'a'.repeat(64)}` };
      const bob = { tier: 'free', region: 'US', user_hash: `sha256:${'b'.repeat(64)}` };
      const first = await s.evaluate(evaluateBody(s.appId, { conversation_id: 'c1', user: alice }));
      expect(first.decision).toBe('serve');
      const second = await s.evaluate(
        evaluateBody(s.appId, { conversation_id: 'c2', user: alice }),
      );
      expect(second.reason).toBe('frequency_cap');
      expect(await capDetail(s, second.audit_id)).toBe('session=0/1 day=1/1 turns_since=none');
      const other = await s.evaluate(evaluateBody(s.appId, { conversation_id: 'c3', user: bob }));
      expect(other.decision).toBe('serve');
      const days = await s.handle.db
        .select()
        .from(userDayCaps)
        .where(eq(userDayCaps.appId, s.appId));
      expect(days.map((d) => [d.userHash, d.count]).sort()).toEqual([
        [alice.user_hash, 1],
        [bob.user_hash, 1],
      ]);
      expect(await capRow(s, 'c2')).toMatchObject({
        sessionCount: 0,
        turnCount: 1,
        lastTurnIndex: null,
        userHash: alice.user_hash,
      });
    });
  });
});
