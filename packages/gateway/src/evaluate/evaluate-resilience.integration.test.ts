import { AuditRecord, type AffiliateConfig } from '@adgate/schemas';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { apps, auditRecords, capState, rawText } from '../db/schema.js';
import {
  auditRow,
  createHarness,
  evaluateBody,
  type Harness,
  type HarnessOptions,
  withHarness,
} from './test-support.js';

/** Failures inside the real transaction, a stuck lock holder, and a bad affiliate config. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

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

const BLOCK_AUDIT_INSERTS = `
  create or replace function adgate_test_block_audit_insert() returns trigger language plpgsql as $$
  begin raise exception 'audit_records insert blocked by the test'; end $$;
  create trigger adgate_test_block_audit_insert before insert on audit_records
  for each row execute function adgate_test_block_audit_insert();
`;
const UNBLOCK_AUDIT_INSERTS = `
  drop trigger if exists adgate_test_block_audit_insert on audit_records;
  drop function if exists adgate_test_block_audit_insert();
`;

const rowCount = async (
  harness: Harness,
  table: typeof auditRecords | typeof capState | typeof rawText,
) => (await harness.handle.db.select({ n: count() }).from(table))[0]?.n;

const evaluateLine = (harness: Harness, auditId: string): Record<string, unknown> =>
  JSON.parse(
    harness.lines.find((l) => l.includes('"msg":"evaluate"') && l.includes(auditId)) ?? '{}',
  ) as Record<string, unknown>;

describe('POST /v1/evaluate fails closed through the real transaction', () => {
  it('when the audit_records insert fails: 200 suppress/error, no record, no counted turn', async () => {
    await h.handle.sql.unsafe(BLOCK_AUDIT_INSERTS);
    try {
      const res = await h.evaluate(evaluateBody(h.appId));
      expect(res.decision).toBe('suppress');
      expect(res.reason).toBe('error');
      expect(res.creative).toBeNull();
      expect(res.audit_id).toMatch(/^aud_/);
      expect(await rowCount(h, auditRecords)).toBe(0);
      expect(await rowCount(h, capState)).toBe(0);
      expect(await rowCount(h, rawText)).toBe(0);
      // drizzle wraps driver failures in a DrizzleQueryError whose name is the bare Error (its
      // message would quote the query, which is why only the name is ever logged).
      expect(evaluateLine(h, res.audit_id)).toMatchObject({
        persisted: false,
        error_name: 'Error',
        reason: 'error',
      });
      // The id in the response has no record: the error line names it for the operator.
      expect(
        h.lines.some(
          (l) =>
            l.includes('"level":50') && l.includes(res.audit_id) && l.includes('not persisted'),
        ),
      ).toBe(true);
      expect(h.lines.some((l) => l.includes('blocked by the test'))).toBe(false);
    } finally {
      await h.handle.sql.unsafe(UNBLOCK_AUDIT_INSERTS);
    }
    // The next turn is back to normal and starts the chain.
    const after = await h.evaluate(evaluateBody(h.appId, { turn_id: 'turn_2' }));
    expect(after.decision).toBe('serve');
    expect((await auditRow(h.handle, after.audit_id)).seq).toBe(1);
  });

  it('answers within the lock timeout when another transaction holds the app lock', async () => {
    await isolated({ db: { lockTimeoutMs: 400 } }, async (s) => {
      let release = (): void => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = (): void => undefined;
      const lockHeld = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = s.handle.sql.begin(async (tx) => {
        await tx`select id from apps where id = ${s.appId} for update`;
        locked();
        await released;
      });
      await lockHeld;
      try {
        const started = Date.now();
        const res = await s.evaluate(evaluateBody(s.appId));
        const elapsed = Date.now() - started;
        expect(res.decision).toBe('suppress');
        expect(res.reason).toBe('error');
        // Two lock waits (the record, then the fail-closed record), 400 ms each; never a hang.
        expect(elapsed).toBeGreaterThanOrEqual(350);
        expect(elapsed).toBeLessThan(1_500);
        expect(evaluateLine(s, res.audit_id)).toMatchObject({
          persisted: false,
          error_name: 'Error',
        });
        expect(await rowCount(s, auditRecords)).toBe(0);
      } finally {
        release();
        await holder;
      }
      const after = await s.evaluate(evaluateBody(s.appId, { turn_id: 'turn_2' }));
      expect(after.decision).toBe('serve');
    });
  });
});

describe('apps.affiliate_config', () => {
  it('a malformed value disables affiliate demand with a warning while direct still serves', async () => {
    await h.handle.db
      .update(apps)
      .set({ affiliateConfig: { partnerstack: 'not-a-config-xyz' } as unknown as AffiliateConfig })
      .where(eq(apps.id, h.appId));
    try {
      const res = await h.evaluate(evaluateBody(h.appId));
      expect(res.decision).toBe('serve');
      expect(res.creative?.source).toBe('direct');
      const record = AuditRecord.parse((await auditRow(h.handle, res.audit_id)).record);
      expect(record.demand.requested).toEqual(['direct', 'affiliate']);
      expect(record.demand.responses[1]).toMatchObject({
        source: 'affiliate',
        candidates: 0,
        error: 'affiliate_not_configured',
      });
      const warning = h.lines.find((l) => l.includes('affiliate_config'));
      expect(JSON.parse(warning ?? '{}')).toMatchObject({ level: 40, app_id: h.appId });
      expect(h.lines.some((l) => l.includes('not-a-config-xyz'))).toBe(false);
    } finally {
      await h.handle.db.update(apps).set({ affiliateConfig: null }).where(eq(apps.id, h.appId));
    }
  });
});
