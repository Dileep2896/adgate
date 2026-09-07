import { sha256Prefixed } from '@adgateio/core';
import { AuditRecord, ErrorResponse } from '@adgateio/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerApp } from '../apps/register-app.js';
import {
  createHarness,
  evaluateBody,
  expectChecks,
  type Harness,
  storedCreativeHash,
  TEXT,
  verifyRow,
} from '../evaluate/test-support.js';
import { auditVersions, postJson } from '../test-support/routes.js';

/** POST /v1/attest (docs/api.md): a new, superseding version of the record at the next seq. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

const MODEL_OUTPUT_HASH = sha256Prefixed('the complete model answer');
const UNKNOWN_AUDIT_ID = 'aud_01ARZ3NDEKTSV4RRFFQ69G5FAV';

const attestBody = (audit_id: string, patch: Record<string, unknown> = {}) => ({
  audit_id,
  model_output_hash: MODEL_OUTPUT_HASH,
  rendered: true,
  ...patch,
});

const postAttest = (body: unknown, apiKey?: string | null) =>
  postJson(h, '/v1/attest', body, { apiKey });

describe('POST /v1/attest', () => {
  it('supersedes a serve record with an attested version that verifies, and the old one still verifies', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    expect(served.decision).toBe('serve');

    const res = await postAttest(attestBody(served.audit_id));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    const versions = await auditVersions(h.handle, served.audit_id);
    expect(versions).toHaveLength(2);
    const [old, attested] = versions;
    expect(old?.isLatest).toBe(false);
    expect(old?.attestRendered).toBeNull();
    expect(old?.supersedesHash).toBeNull();
    expect(attested?.isLatest).toBe(true);
    expect(attested?.seq).toBe((old?.seq ?? 0) + 1);
    expect(attested?.supersedesHash).toBe(old?.recordHash);
    expect(attested?.prevHash).toBe(old?.recordHash);
    expect(attested?.attestRendered).toBe(true);
    expect(attested?.decision).toBe('serve');
    expect(attested?.reason).toBeNull();
    expect(attested?.creativeId).toBe(old?.creativeId);
    expect(attested?.advertiserId).toBe(old?.advertiserId);
    expect(attested?.ts.toISOString()).toBe(old?.ts.toISOString());

    const oldRecord = AuditRecord.parse(old?.record);
    const record = AuditRecord.parse(attested?.record);
    expect(record.id).toBe(served.audit_id);
    expect(record.app_id).toBe(h.appId);
    expect(record.separation_attestation).toBe(true);
    expect(record.model_output_hash).toBe(MODEL_OUTPUT_HASH);
    expect(record.attested_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(record.supersedes_hash).toBe(oldRecord.record_hash);
    expect(record.prev_hash).toBe(oldRecord.record_hash);
    expect(record.record_hash).toBe(attested?.recordHash);
    expect(record.creative).toEqual(oldRecord.creative);
    expect(record.classification).toEqual(oldRecord.classification);
    expect(record.key_id).toBe('k_test');

    const stored = await storedCreativeHash(h.handle, record.creative?.id ?? '');
    expectChecks(
      verifyRow(h, attested!, {
        prevRecord: oldRecord,
        storedCreativeHash: stored,
        supersededRecord: oldRecord,
        superseded: { prevRecord: null },
      }),
    );
    const older = verifyRow(h, old!, {
      prevRecord: null,
      storedCreativeHash: stored,
      supersededBy: record,
    });
    expectChecks(older);
    expect(older.checks.find((c) => c.name === 'separation_attested')?.detail).toBe(
      'attested by superseding record',
    );

    const line = h.lines.find((entry) => entry.includes('"msg":"attest"'));
    expect(line).toBeDefined();
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      app_id: h.appId,
      audit_id: served.audit_id,
      seq: 2,
      superseded_seq: 1,
      rendered: true,
    });
  });

  it('attests a suppress record too, storing rendered false', async () => {
    const suppressed = await h.evaluate(evaluateBody(h.appId, { content: TEXT.health }));
    expect(suppressed.decision).toBe('suppress');

    const res = await postAttest(attestBody(suppressed.audit_id, { rendered: false }));
    expect(res.status).toBe(204);

    const [old, attested] = await auditVersions(h.handle, suppressed.audit_id);
    expect(attested?.attestRendered).toBe(false);
    expect(attested?.decision).toBe('suppress');
    expect(attested?.reason).toBe('sensitive_category:health');
    expect(attested?.creativeId).toBeNull();
    const oldRecord = AuditRecord.parse(old?.record);
    expectChecks(
      verifyRow(h, attested!, {
        prevRecord: oldRecord,
        supersededRecord: oldRecord,
        superseded: { prevRecord: null },
      }),
    );
    expectChecks(verifyRow(h, old!, { prevRecord: null, supersededBy: attested?.record }));
  });

  it('rejects a second attestation with 409 already_attested and writes nothing', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    expect((await postAttest(attestBody(served.audit_id))).status).toBe(204);

    const res = await postAttest(
      attestBody(served.audit_id, { model_output_hash: sha256Prefixed('x') }),
    );
    expect(res.status).toBe(409);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe('already_attested');
    expect(await auditVersions(h.handle, served.audit_id)).toHaveLength(2);
  });

  it('answers 404 not_found for another app’s audit id and for an unknown one', async () => {
    const other = await registerApp(h.handle.db, { name: 'Other App' });
    const served = await h.evaluate(evaluateBody(h.appId));

    const foreign = await postAttest(attestBody(served.audit_id), other.key.api_key);
    expect(foreign.status).toBe(404);
    expect(ErrorResponse.parse(await foreign.json()).error.code).toBe('not_found');
    expect(await auditVersions(h.handle, served.audit_id)).toHaveLength(1);
    expect((await auditVersions(h.handle, served.audit_id))[0]?.isLatest).toBe(true);

    const unknown = await postAttest(attestBody(UNKNOWN_AUDIT_ID));
    expect(unknown.status).toBe(404);
    expect(ErrorResponse.parse(await unknown.json()).error.code).toBe('not_found');
  });

  it('rejects a malformed body with 400 invalid_request', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));

    const badHash = await postAttest(
      attestBody(served.audit_id, { model_output_hash: 'sha256:abc' }),
    );
    expect(badHash.status).toBe(400);
    const body = ErrorResponse.parse(await badHash.json());
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toContain('model_output_hash');

    const noRendered = await postAttest({
      audit_id: served.audit_id,
      model_output_hash: MODEL_OUTPUT_HASH,
    });
    expect(noRendered.status).toBe(400);

    const notJson = await postJson(h, '/v1/attest', null, { raw: '{not json' });
    expect(notJson.status).toBe(400);
    expect(ErrorResponse.parse(await notJson.json()).error.code).toBe('invalid_request');

    expect(await auditVersions(h.handle, served.audit_id)).toHaveLength(1);
  });

  it('requires an app key', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    const res = await postAttest(attestBody(served.audit_id), null);
    expect(res.status).toBe(401);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe('unauthorized');
  });
});
