import { sha256Prefixed } from '@adgateio/core';
import { AuditRecord, ErrorResponse, VerifyResponse } from '@adgateio/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerApp } from '../apps/register-app.js';
import {
  createHarness,
  evaluateBody,
  expectChecks,
  type Harness,
  TEXT,
} from '../evaluate/test-support.js';
import {
  auditVersions,
  getAudit,
  getVerify,
  issueAdvertiserKey,
  postJson,
} from '../test-support/routes.js';

/** GET /v1/audit/:id and GET /v1/verify/:id (docs/api.md) for app and advertiser_read keys. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

const UNKNOWN_AUDIT_ID = 'aud_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CHECK_ORDER = [
  'schema',
  'record_hash',
  'chain',
  'signature',
  'creative_hash',
  'disclosure_present',
  'separation_attested',
  'supersedes',
];

const attestOk = async (audit_id: string): Promise<void> => {
  const res = await postJson(h, '/v1/attest', {
    audit_id,
    model_output_hash: sha256Prefixed(`answer for ${audit_id}`),
    rendered: true,
  });
  expect(res.status).toBe(204);
};

const readVerify = async (auditId: string, options = {}): Promise<VerifyResponse> => {
  const res = await getVerify(h, auditId, options);
  expect(res.status).toBe(200);
  return VerifyResponse.parse(await res.json());
};

const detailOf = (result: VerifyResponse, name: string): string | undefined =>
  result.checks.find((check) => check.name === name)?.detail;

const expectNotFound = async (res: Response): Promise<void> => {
  expect(res.status).toBe(404);
  expect(ErrorResponse.parse(await res.json()).error.code).toBe('not_found');
};

describe('GET /v1/audit/:id', () => {
  it('returns the stored record of a serve evaluation with its hash in a header', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    expect(served.decision).toBe('serve');

    const res = await getAudit(h, served.audit_id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const [row] = await auditVersions(h.handle, served.audit_id);
    const body: unknown = await res.json();
    expect(body).toEqual(row?.record);
    const record = AuditRecord.parse(body);
    expect(record.id).toBe(served.audit_id);
    expect(record.app_id).toBe(h.appId);
    expect(record.decision).toBe('serve');
    expect(record.creative?.id).toBe(served.creative?.id);
    expect(record.record_hash).toBe(row?.recordHash);
    expect(res.headers.get('x-adgate-record-hash')).toBe(row?.recordHash);

    const line = h.lines.find((entry) => entry.includes('"msg":"audit read"'));
    expect(line).toBeDefined();
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      app_id: h.appId,
      key_id: h.registered.key.key_id,
      audit_id: served.audit_id,
      seq: 1,
    });
    expect(line).not.toContain(record.conversation_id_hash);
  });

  it('returns a suppress record too', async () => {
    const suppressed = await h.evaluate(evaluateBody(h.appId, { content: TEXT.health }));
    expect(suppressed.decision).toBe('suppress');

    const res = await getAudit(h, suppressed.audit_id);
    expect(res.status).toBe(200);
    const record = AuditRecord.parse(await res.json());
    expect(record.decision).toBe('suppress');
    expect(record.reason).toBe('sensitive_category:health');
    expect(record.creative).toBeNull();
  });

  it('serves the attested version by default and a superseded one through ?version=', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    await attestOk(served.audit_id);
    const [original, attested] = await auditVersions(h.handle, served.audit_id);

    const latest = await getAudit(h, served.audit_id);
    expect(latest.status).toBe(200);
    expect(latest.headers.get('x-adgate-record-hash')).toBe(attested?.recordHash);
    const latestRecord = AuditRecord.parse(await latest.json());
    expect(latestRecord.separation_attestation).toBe(true);
    expect(latestRecord.supersedes_hash).toBe(original?.recordHash);

    const older = await getAudit(h, served.audit_id, { version: original?.recordHash });
    expect(older.status).toBe(200);
    expect(older.headers.get('x-adgate-record-hash')).toBe(original?.recordHash);
    const olderRecord = AuditRecord.parse(await older.json());
    expect(olderRecord.separation_attestation).toBe(false);
    expect(olderRecord.record_hash).toBe(original?.recordHash);

    const byHash = await getAudit(h, served.audit_id, { version: attested?.recordHash });
    expect(byHash.status).toBe(200);
    expect(AuditRecord.parse(await byHash.json()).record_hash).toBe(attested?.recordHash);

    await expectNotFound(await getAudit(h, served.audit_id, { version: sha256Prefixed('nope') }));
    await expectNotFound(await getAudit(h, served.audit_id, { version: 'not-a-hash' }));
  });
});

describe('GET /v1/verify/:id', () => {
  it('verifies a serve record: all eight checks, valid once attested, and the superseded version too', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));

    const unattested = await readVerify(served.audit_id);
    expect(unattested.checks.map((check) => check.name)).toEqual(CHECK_ORDER);
    expectChecks(unattested, ['separation_attested']);
    expect(detailOf(unattested, 'separation_attested')).toBe('not attested');
    expect(detailOf(unattested, 'chain')).toBe('genesis');
    expect(detailOf(unattested, 'signature')).toBe('key_id=k_test');
    expect(detailOf(unattested, 'creative_hash')).toBeUndefined();
    expect(detailOf(unattested, 'supersedes')).toBe('not applicable');

    await attestOk(served.audit_id);
    const [original, attested] = await auditVersions(h.handle, served.audit_id);
    const latestRes = await getVerify(h, served.audit_id);
    expect(latestRes.status).toBe(200);
    expect(latestRes.headers.get('x-adgate-record-hash')).toBe(attested?.recordHash);
    const latest = VerifyResponse.parse(await latestRes.json());
    expectChecks(latest);
    expect(latest.checks).toHaveLength(8);
    expect(detailOf(latest, 'chain')).toBeUndefined();
    expect(detailOf(latest, 'separation_attested')).toBeUndefined();
    expect(detailOf(latest, 'supersedes')).toBe('superseded record verified');

    const older = await readVerify(served.audit_id, { version: original?.recordHash });
    expectChecks(older);
    expect(detailOf(older, 'chain')).toBe('genesis');
    expect(detailOf(older, 'separation_attested')).toBe('attested by superseding record');

    const line = h.lines.find((entry) => entry.includes('"msg":"verify"'));
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      audit_id: served.audit_id,
      valid: false,
      failed: ['separation_attested'],
    });
  });

  it('verifies a suppress record with creative_hash and separation_attested not applicable', async () => {
    const suppressed = await h.evaluate(evaluateBody(h.appId, { content: TEXT.health }));

    const result = await readVerify(suppressed.audit_id);
    expectChecks(result);
    expect(detailOf(result, 'creative_hash')).toBe('not applicable');
    expect(detailOf(result, 'separation_attested')).toBe('not applicable');
    expect(detailOf(result, 'supersedes')).toBe('not applicable');

    await attestOk(suppressed.audit_id);
    const attested = await readVerify(suppressed.audit_id);
    expectChecks(attested);
    expect(detailOf(attested, 'separation_attested')).toBeUndefined();
    expect(detailOf(attested, 'creative_hash')).toBe('not applicable');
  });
});

describe('authorization', () => {
  it('lets an advertiser_read key read and verify only records naming its creatives', async () => {
    const dbCloud = await issueAdvertiserKey(h, 'exampledb.dev');
    const deploy = await issueAdvertiserKey(h, 'exampledeploy.dev');
    const served = await h.evaluate(evaluateBody(h.appId));
    expect(served.creative?.advertiser).toBe('Example DB Cloud');
    await attestOk(served.audit_id);
    const suppressed = await h.evaluate(
      evaluateBody(h.appId, { conversation_id: 'conv_2', content: TEXT.health }),
    );

    const read = await getAudit(h, served.audit_id, { apiKey: dbCloud });
    expect(read.status).toBe(200);
    expect(AuditRecord.parse(await read.json()).creative?.advertiser_domain).toBe('exampledb.dev');
    expectChecks(await readVerify(served.audit_id, { apiKey: dbCloud }));

    await expectNotFound(await getAudit(h, suppressed.audit_id, { apiKey: dbCloud }));
    await expectNotFound(await getVerify(h, suppressed.audit_id, { apiKey: dbCloud }));
    await expectNotFound(await getAudit(h, served.audit_id, { apiKey: deploy }));
    await expectNotFound(await getVerify(h, served.audit_id, { apiKey: deploy }));

    // The scope is the advertiser, not the app that issued the key: a global-catalog creative
    // serves in any app and its advertiser may verify every record that names it.
    const other = await registerApp(h.handle.db, { name: 'Other App' });
    const otherDbCloud = await issueAdvertiserKey(h, 'exampledb.dev', other.app.id);
    expect((await getAudit(h, served.audit_id, { apiKey: otherDbCloud })).status).toBe(200);
  });

  it('answers 404 for another app’s key, an unknown id and a malformed id', async () => {
    const other = await registerApp(h.handle.db, { name: 'Other App' });
    const served = await h.evaluate(evaluateBody(h.appId));

    await expectNotFound(await getAudit(h, served.audit_id, { apiKey: other.key.api_key }));
    await expectNotFound(await getVerify(h, served.audit_id, { apiKey: other.key.api_key }));
    await expectNotFound(await getAudit(h, UNKNOWN_AUDIT_ID));
    await expectNotFound(await getVerify(h, UNKNOWN_AUDIT_ID));
    await expectNotFound(await getAudit(h, 'nonsense'));
    await expectNotFound(await getVerify(h, 'nonsense'));
  });

  it('requires a valid API key', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    for (const apiKey of [null, 'ak_notakeyatall_' + 'x'.repeat(43)]) {
      const audit = await getAudit(h, served.audit_id, { apiKey });
      expect(audit.status).toBe(401);
      expect(ErrorResponse.parse(await audit.json()).error.code).toBe('unauthorized');
      const verify = await getVerify(h, served.audit_id, { apiKey });
      expect(verify.status).toBe(401);
    }
  });
});
