import { VERIFY_DETAIL } from '@adgate/core';
import type { VerifyResponse } from '@adgate/schemas';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditRecords } from '../db/tables/audit.js';
import { retentionState } from '../db/tables/retention.js';
import { TEXT } from '../evaluate/test-support.js';
import { runRetention } from './run.js';
import {
  createRetentionHarness,
  RETAIN_DAYS,
  type RetentionApp,
  type RetentionHarness,
  seqsOf,
  turn,
} from './test-support.js';

/**
 * WHAT A PRUNED CHAIN LOOKS LIKE TO THE VERIFIER.
 *
 * Retention shortens an app's chain from the oldest end, so the oldest surviving record has no
 * predecessor to check against. That must read as `chain` ok with detail 'pruned' - the log is
 * short by policy, not broken - and it must NOT become a blanket excuse: a record deleted
 * anywhere else in the chain still fails 'previous record missing', and a record that predates
 * the cutoff its own predecessor was pruned under fails too. These three cases are the whole
 * reason the watermark carries a chain position and a cutoff instead of a boolean.
 *
 * Every assertion goes through the real GET /v1/verify/:id, so it is the answer an integrator
 * or an auditor gets, not an internal helper's opinion.
 */
const NOW = new Date('2026-06-01T00:00:00.000Z');
const CUTOFF = new Date(NOW.getTime() - RETAIN_DAYS * 86_400_000);
const TURN_TIMES = [
  new Date('2026-03-01T09:00:00.000Z'),
  new Date('2026-03-02T09:00:00.000Z'),
  new Date('2026-03-03T09:00:00.000Z'),
  new Date('2026-05-10T09:00:00.000Z'),
  new Date('2026-05-11T09:00:00.000Z'),
  new Date('2026-05-12T09:00:00.000Z'),
];

let harness: RetentionHarness | undefined;

beforeEach(async () => {
  harness = await createRetentionHarness();
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const verifyOf = async (h: RetentionHarness, auditId: string): Promise<VerifyResponse> => {
  const res = await h.h.app.request(`/v1/verify/${auditId}`, {
    headers: { authorization: `Bearer ${h.h.apiKey}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as VerifyResponse;
};

const chainCheck = (result: VerifyResponse) => {
  const check = result.checks.find((entry) => entry.name === 'chain');
  if (check === undefined) {
    throw new Error('verify returned no chain check');
  }
  return check;
};

/** Six suppress turns spanning the cutoff; suppress records are attestation-free, so an */
/** untouched one passes all eight checks and any failure is unambiguous. */
const seedChain = async (h: RetentionHarness): Promise<string[]> => {
  const app: RetentionApp = { appId: h.h.appId, apiKey: h.h.apiKey };
  const ids: string[] = [];
  for (const at of TURN_TIMES) {
    const res = await turn(h, app, at, { content: TEXT.health });
    expect(res.decision).toBe('suppress');
    ids.push(res.audit_id);
  }
  return ids;
};

describe('verify after the retention job pruned the oldest records', () => {
  it('reports the oldest surviving record as chain ok, detail pruned, and still valid', async () => {
    const h = harness!;
    const ids = await seedChain(h);
    await runRetention(h.h.handle.db, { now: NOW });
    expect(await seqsOf(h.h.handle, h.h.appId)).toEqual([4, 5, 6]);

    const result = await verifyOf(h, ids[3]!);

    expect(chainCheck(result)).toEqual({ name: 'chain', ok: true, detail: VERIFY_DETAIL.pruned });
    expect(result.valid).toBe(true);
    for (const check of result.checks) {
      expect(check.ok, `${check.name}: ${check.detail ?? ''}`).toBe(true);
    }
  });

  it('leaves the records above it verifying against their real predecessors', async () => {
    const h = harness!;
    const ids = await seedChain(h);
    await runRetention(h.h.handle.db, { now: NOW });

    for (const id of [ids[4]!, ids[5]!]) {
      const result = await verifyOf(h, id);
      expect(chainCheck(result)).toEqual({ name: 'chain', ok: true });
      expect(result.valid).toBe(true);
    }
  });

  it('still fails previous_missing for a record deleted anywhere but the pruned prefix', async () => {
    const h = harness!;
    const ids = await seedChain(h);
    await runRetention(h.h.handle.db, { now: NOW });

    // seq 5 removed by hand: above the watermark, so the watermark says nothing about it.
    await h.h.handle.db.delete(auditRecords).where(eq(auditRecords.id, ids[4]!));
    expect(await seqsOf(h.h.handle, h.h.appId)).toEqual([4, 6]);

    const result = await verifyOf(h, ids[5]!);

    expect(chainCheck(result)).toEqual({
      name: 'chain',
      ok: false,
      detail: VERIFY_DETAIL.previous_missing,
    });
    expect(result.valid).toBe(false);
  });

  it('refuses to excuse a record that predates the cutoff its predecessor was pruned under', async () => {
    const h = harness!;
    const ids = await seedChain(h);
    await runRetention(h.h.handle.db, { now: NOW });
    // A watermark moved past the oldest surviving record cannot make it look retained.
    await h.h.handle.db
      .update(retentionState)
      .set({ prunedBefore: new Date('2026-05-11T00:00:00.000Z') })
      .where(eq(retentionState.appId, h.h.appId));

    const result = await verifyOf(h, ids[3]!);

    expect(chainCheck(result)).toEqual({
      name: 'chain',
      ok: false,
      detail: VERIFY_DETAIL.pruned_before_cutoff,
    });
    expect(result.valid).toBe(false);
  });

  it('fails previous_missing for an app the job has never pruned', async () => {
    const h = harness!;
    const ids = await seedChain(h);
    await h.h.handle.db.delete(auditRecords).where(eq(auditRecords.id, ids[0]!));
    expect(await watermarkExists(h)).toBe(false);

    const result = await verifyOf(h, ids[1]!);

    expect(chainCheck(result)).toEqual({
      name: 'chain',
      ok: false,
      detail: VERIFY_DETAIL.previous_missing,
    });
  });

  it('measures the cutoff from the app policy, not from the run clock', async () => {
    const h = harness!;
    await seedChain(h);
    await runRetention(h.h.handle.db, { now: NOW });
    const [row] = await h.h.handle.db
      .select()
      .from(retentionState)
      .where(eq(retentionState.appId, h.h.appId));
    expect(row?.prunedBefore.toISOString()).toBe(CUTOFF.toISOString());
  });
});

const watermarkExists = async (h: RetentionHarness): Promise<boolean> => {
  const rows = await h.h.handle.db
    .select()
    .from(retentionState)
    .where(eq(retentionState.appId, h.h.appId));
  return rows.length > 0;
};
