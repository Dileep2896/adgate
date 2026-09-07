import { sha256Prefixed } from '@adgateio/core';
import { ErrorResponse, VerifyResponse } from '@adgateio/schemas';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { creatives } from '../db/schema.js';
import {
  createHarness,
  evaluateBody,
  expectChecks,
  type Harness,
  TEXT,
} from '../evaluate/test-support.js';
import { auditVersions, getAudit, getVerify, postJson } from '../test-support/routes.js';

/** Records tampered directly in Postgres fail GET /v1/verify/:id on the right check. */
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

/** jsonb_set on the stored record of one version; `path` is a Postgres text[] literal. */
const setRecordField = (recordHash: string, path: string, value: unknown): Promise<unknown> =>
  h.handle.sql.unsafe(
    'update audit_records set record = jsonb_set(record, $1::text[], $2::jsonb) where record_hash = $3',
    [path, JSON.stringify(value), recordHash],
  );

const readVerify = async (auditId: string, version?: string): Promise<VerifyResponse> => {
  const res = await getVerify(h, auditId, { version });
  expect(res.status).toBe(200);
  return VerifyResponse.parse(await res.json());
};

const detailOf = (result: VerifyResponse, name: string): string | undefined =>
  result.checks.find((check) => check.name === name)?.detail;

/** A signature of the right shape that was not produced by the key: one base64 digit changed. */
const flipSignature = (signature: string): string => {
  const at = signature.length - 5;
  const replacement = signature[at] === 'A' ? 'B' : 'A';
  return signature.slice(0, at) + replacement + signature.slice(at + 1);
};

describe('GET /v1/verify/:id on tampered rows', () => {
  it('fails record_hash when a field inside the signed body changes (signature still checks the stored hash)', async () => {
    const suppressed = await h.evaluate(evaluateBody(h.appId, { content: TEXT.health }));
    const [row] = await auditVersions(h.handle, suppressed.audit_id);
    await setRecordField(row?.recordHash ?? '', '{classification,commercial_intent}', 0.99);

    const result = await readVerify(suppressed.audit_id);
    expectChecks(result, ['record_hash']);
    expect(detailOf(result, 'record_hash')).toBe('record_hash does not recompute from the record');
    expect(detailOf(result, 'signature')).toBe('key_id=k_test');
  });

  it('fails record_hash and the supersedes body comparison when an attested record is edited', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    await attestOk(served.audit_id);
    const [, attested] = await auditVersions(h.handle, served.audit_id);
    await setRecordField(attested?.recordHash ?? '', '{classification,commercial_intent}', 0.01);

    const result = await readVerify(served.audit_id);
    expectChecks(result, ['record_hash', 'supersedes']);
    expect(detailOf(result, 'supersedes')).toBe('body_mismatch');
  });

  it('fails creative_hash when the stored creative changed after the serve', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    await attestOk(served.audit_id);
    const creativeId = served.creative?.id ?? '';
    const [before] = await h.handle.db.select().from(creatives).where(eq(creatives.id, creativeId));
    try {
      await h.handle.db
        .update(creatives)
        .set({ headline: 'A different headline' })
        .where(eq(creatives.id, creativeId));

      const result = await readVerify(served.audit_id);
      expectChecks(result, ['creative_hash', 'supersedes']);
      expect(detailOf(result, 'creative_hash')).toBe(
        'content_hash does not match the stored creative',
      );
      expect(detailOf(result, 'supersedes')).toBe('superseded record invalid: creative_hash');
      // Reading the record is unaffected: the read endpoint serves what is stored.
      expect((await getAudit(h, served.audit_id)).status).toBe(200);
    } finally {
      await h.handle.db
        .update(creatives)
        .set({ headline: before?.headline ?? '' })
        .where(eq(creatives.id, creativeId));
    }
  });

  it('fails disclosure_present (and record_hash) for a blank label, and schema for an empty one', async () => {
    const suppressed = await h.evaluate(evaluateBody(h.appId, { content: TEXT.health }));
    const [row] = await auditVersions(h.handle, suppressed.audit_id);
    const hash = row?.recordHash ?? '';

    await setRecordField(hash, '{disclosure,label}', ' ');
    const blank = await readVerify(suppressed.audit_id);
    expectChecks(blank, ['record_hash', 'disclosure_present']);
    expect(detailOf(blank, 'disclosure_present')).toBe('label empty');

    await setRecordField(hash, '{disclosure,label}', '');
    const empty = await readVerify(suppressed.audit_id);
    expect(empty.valid).toBe(false);
    expect(empty.checks.every((check) => !check.ok)).toBe(true);
    expect(detailOf(empty, 'schema')).toContain('disclosure.label');
    expect(detailOf(empty, 'record_hash')).toBe('skipped: schema invalid');

    // The read endpoint refuses to serve a stored record that no longer satisfies the contract.
    const read = await getAudit(h, suppressed.audit_id);
    expect(read.status).toBe(500);
    expect(ErrorResponse.parse(await read.json()).error.code).toBe('internal_error');
    const line = h.lines.find((entry) => entry.includes('does not satisfy the contract'));
    expect(JSON.parse(line ?? '{}')).toMatchObject({ level: 50, audit_id: suppressed.audit_id });
  });

  it('fails signature with bad_signature for a tampered signature string', async () => {
    const suppressed = await h.evaluate(evaluateBody(h.appId, { content: TEXT.health }));
    const [row] = await auditVersions(h.handle, suppressed.audit_id);
    const signature = row?.record.signature ?? '';
    await setRecordField(row?.recordHash ?? '', '{signature}', flipSignature(signature));

    const result = await readVerify(suppressed.audit_id);
    expectChecks(result, ['signature']);
    expect(detailOf(result, 'signature')).toBe('bad_signature');
  });

  it('fails creative_hash with stored creative missing when the creatives row is gone', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    const creativeId = served.creative?.id ?? '';
    const [before] = await h.handle.db.select().from(creatives).where(eq(creatives.id, creativeId));
    try {
      await h.handle.db.delete(creatives).where(eq(creatives.id, creativeId));

      const result = await readVerify(served.audit_id);
      expectChecks(result, ['creative_hash', 'separation_attested']);
      expect(detailOf(result, 'creative_hash')).toBe('stored creative missing');
    } finally {
      if (before !== undefined) {
        await h.handle.db.insert(creatives).values(before);
      }
    }
  });
});
