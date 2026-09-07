import { sha256Prefixed } from '@adgateio/core';
import { AuditRecord, VerifyResponse } from '@adgateio/schemas';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditRecords } from '../db/schema.js';
import {
  auditRowsInOrder,
  createHarness,
  evaluateBody,
  expectChecks,
  type Harness,
  TEXT,
} from '../evaluate/test-support.js';
import { auditVersions, getAudit, getVerify, postJson } from '../test-support/routes.js';

/** The chain context GET /v1/verify/:id builds from audit_records.seq. */
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

const readVerify = async (auditId: string, version?: string): Promise<VerifyResponse> => {
  const res = await getVerify(h, auditId, { version });
  expect(res.status).toBe(200);
  return VerifyResponse.parse(await res.json());
};

const readRecord = async (auditId: string, version?: string): Promise<AuditRecord> => {
  const res = await getAudit(h, auditId, { version });
  expect(res.status).toBe(200);
  return AuditRecord.parse(await res.json());
};

const detailOf = (result: VerifyResponse, name: string): string | undefined =>
  result.checks.find((check) => check.name === name)?.detail;

const threeSuppressions = async (): Promise<string[]> => {
  const ids: string[] = [];
  for (const conversation of ['conv_1', 'conv_2', 'conv_3']) {
    const res = await h.evaluate(
      evaluateBody(h.appId, { conversation_id: conversation, content: TEXT.health }),
    );
    ids.push(res.audit_id);
  }
  return ids;
};

describe('GET /v1/verify/:id along the chain', () => {
  it('verifies three evaluations and their attestations, each against the row at seq - 1', async () => {
    const a = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_a' }));
    const b = await h.evaluate(
      evaluateBody(h.appId, { conversation_id: 'conv_b', content: TEXT.health }),
    );
    const c = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_c' }));
    expect([a.decision, b.decision, c.decision]).toEqual(['serve', 'suppress', 'serve']);

    expectChecks(await readVerify(a.audit_id), ['separation_attested']);
    expectChecks(await readVerify(b.audit_id));
    expectChecks(await readVerify(c.audit_id), ['separation_attested']);

    await attestOk(a.audit_id);
    await attestOk(c.audit_id);
    for (const id of [a.audit_id, b.audit_id, c.audit_id]) {
      expectChecks(await readVerify(id));
    }

    const rows = await auditRowsInOrder(h.handle, h.appId);
    expect(rows.map((row) => [row.seq, row.id])).toEqual([
      [1, a.audit_id],
      [2, b.audit_id],
      [3, c.audit_id],
      [4, a.audit_id],
      [5, c.audit_id],
    ]);
    const [a1] = await auditVersions(h.handle, a.audit_id);
    const [c1] = await auditVersions(h.handle, c.audit_id);
    const originalA = await readRecord(a.audit_id, a1?.recordHash);
    const recordB = await readRecord(b.audit_id);
    const originalC = await readRecord(c.audit_id, c1?.recordHash);
    const attestedA = await readRecord(a.audit_id);
    const attestedC = await readRecord(c.audit_id);
    expect(originalA.prev_hash).toBe('genesis');
    expect(recordB.prev_hash).toBe(originalA.record_hash);
    expect(originalC.prev_hash).toBe(recordB.record_hash);
    expect(attestedA.prev_hash).toBe(originalC.record_hash);
    expect(attestedC.prev_hash).toBe(attestedA.record_hash);

    expectChecks(await readVerify(a.audit_id, a1?.recordHash));
    expectChecks(await readVerify(c.audit_id, c1?.recordHash));
    expect(detailOf(await readVerify(a.audit_id, a1?.recordHash), 'chain')).toBe('genesis');
  });

  it('fails chain when prev_hash points at an older record than the positional predecessor', async () => {
    const [first, , third] = await threeSuppressions();
    const rows = await auditRowsInOrder(h.handle, h.appId);
    const olderHash = rows[0]?.recordHash ?? '';
    const thirdHash = rows[2]?.recordHash ?? '';
    await h.handle.sql.unsafe(
      "update audit_records set prev_hash = $1, record = jsonb_set(record, '{prev_hash}', to_jsonb($1::text)) where record_hash = $2",
      [olderHash, thirdHash],
    );

    const result = await readVerify(third ?? '');
    expectChecks(result, ['record_hash', 'chain']);
    expect(detailOf(result, 'chain')).toBe('prev_hash does not match the previous record');
    expectChecks(await readVerify(first ?? ''));
  });

  it('fails chain with previous record missing when the row at seq - 1 was deleted', async () => {
    const [, second, third] = await threeSuppressions();
    await h.handle.db
      .delete(auditRecords)
      .where(and(eq(auditRecords.appId, h.appId), eq(auditRecords.seq, 2)));

    const result = await readVerify(third ?? '');
    expectChecks(result, ['chain']);
    expect(detailOf(result, 'chain')).toBe('previous record missing');
    expect((await getAudit(h, second ?? '')).status).toBe(404);
  });

  it('fails chain for a record re-signed as genesis in the middle of the chain', async () => {
    const [, , third] = await threeSuppressions();
    const rows = await auditRowsInOrder(h.handle, h.appId);
    await h.handle.sql.unsafe(
      "update audit_records set prev_hash = 'genesis', record = jsonb_set(record, '{prev_hash}', '\"genesis\"') where record_hash = $1",
      [rows[2]?.recordHash ?? ''],
    );

    const result = await readVerify(third ?? '');
    expectChecks(result, ['record_hash', 'chain']);
    expect(detailOf(result, 'chain')).toBe('genesis record given a previous record');
  });
});
