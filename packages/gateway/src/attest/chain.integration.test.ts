import { sha256Prefixed } from '@adgate/core';
import { AuditRecord } from '@adgate/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  auditRowsInOrder,
  createHarness,
  evaluateBody,
  expectChecks,
  type Harness,
  storedCreativeHash,
  verifyRow,
} from '../evaluate/test-support.js';
import { postJson } from '../test-support/routes.js';

/** The app chain across evaluate and attest: every row verifies against the row at seq - 1. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

const attestOk = async (audit_id: string): Promise<void> => {
  const res = await postJson(h, '/v1/attest', {
    audit_id,
    model_output_hash: sha256Prefixed(`answer for ${audit_id}`),
    rendered: true,
  });
  expect(res.status).toBe(204);
};

describe('evaluate -> attest -> evaluate chain', () => {
  it('takes seq 1, 2, 3 and each record verifies against its positional predecessor', async () => {
    const a = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_a' }));
    await attestOk(a.audit_id);
    const b = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_b' }));

    const rows = await auditRowsInOrder(h.handle, h.appId);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.id)).toEqual([a.audit_id, a.audit_id, b.audit_id]);
    expect(rows.map((row) => row.isLatest)).toEqual([false, true, true]);
    expect(rows.map((row) => row.supersedesHash)).toEqual([null, rows[0]?.recordHash, null]);
    const [r1, r2, r3] = rows.map((row) => AuditRecord.parse(row.record));
    expect(r1?.prev_hash).toBe('genesis');
    expect(r2?.prev_hash).toBe(r1?.record_hash);
    expect(r3?.prev_hash).toBe(r2?.record_hash);

    const hashA = await storedCreativeHash(h.handle, r1?.creative?.id ?? '');
    const hashB = await storedCreativeHash(h.handle, r3?.creative?.id ?? '');
    expectChecks(
      verifyRow(h, rows[0]!, { prevRecord: null, storedCreativeHash: hashA, supersededBy: r2 }),
    );
    expectChecks(
      verifyRow(h, rows[1]!, {
        prevRecord: r1,
        storedCreativeHash: hashA,
        supersededRecord: r1,
        superseded: { prevRecord: null },
      }),
    );
    expectChecks(verifyRow(h, rows[2]!, { prevRecord: r2, storedCreativeHash: hashB }), [
      'separation_attested',
    ]);

    // Skipping the attestation (record 3 against record 1) is a broken chain.
    const forked = verifyRow(h, rows[2]!, { prevRecord: r1, storedCreativeHash: hashB });
    expect(forked.checks.find((c) => c.name === 'chain')).toMatchObject({ ok: false });
  });

  it('attesting after a later evaluation appends at the end and supersedes the earlier record', async () => {
    const a = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_a' }));
    const b = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_b' }));
    await attestOk(a.audit_id);

    const rows = await auditRowsInOrder(h.handle, h.appId);
    expect(rows.map((row) => [row.seq, row.id, row.isLatest])).toEqual([
      [1, a.audit_id, false],
      [2, b.audit_id, true],
      [3, a.audit_id, true],
    ]);
    const [r1, r2, r3] = rows.map((row) => AuditRecord.parse(row.record));
    expect(r3?.prev_hash).toBe(r2?.record_hash);
    expect(r3?.supersedes_hash).toBe(r1?.record_hash);

    const hashA = await storedCreativeHash(h.handle, r1?.creative?.id ?? '');
    const hashB = await storedCreativeHash(h.handle, r2?.creative?.id ?? '');
    expectChecks(
      verifyRow(h, rows[2]!, {
        prevRecord: r2,
        storedCreativeHash: hashA,
        supersededRecord: r1,
        superseded: { prevRecord: null },
      }),
    );
    expectChecks(verifyRow(h, rows[1]!, { prevRecord: r1, storedCreativeHash: hashB }), [
      'separation_attested',
    ]);
    expectChecks(
      verifyRow(h, rows[0]!, { prevRecord: null, storedCreativeHash: hashA, supersededBy: r3 }),
    );
  });
});
