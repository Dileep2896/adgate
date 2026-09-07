import { ErrorResponse } from '@adgateio/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerApp } from '../apps/register-app.js';
import { createHarness, evaluateBody, type Harness } from '../evaluate/test-support.js';
import { eventRows, postJson } from '../test-support/routes.js';

/** POST /v1/events (docs/api.md): one row per event, duplicate impressions ignored. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

const TS = '2026-09-02T18:04:11Z';
const UNKNOWN_AUDIT_ID = 'aud_01ARZ3NDEKTSV4RRFFQ69G5FAV';

const eventBody = (audit_id: string, type: string, patch: Record<string, unknown> = {}) => ({
  audit_id,
  type,
  ts: TS,
  meta: {},
  ...patch,
});

const postEvent = (body: unknown, apiKey?: string | null) =>
  postJson(h, '/v1/events', body, { apiKey });

describe('POST /v1/events', () => {
  it('stores an impression once: a second one is a 204 no-op', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    const first = await postEvent(eventBody(served.audit_id, 'impression', { meta: { slot: 1 } }));
    expect(first.status).toBe(204);
    expect(await first.text()).toBe('');
    const second = await postEvent(eventBody(served.audit_id, 'impression', { meta: { slot: 2 } }));
    expect(second.status).toBe(204);

    const rows = await eventRows(h.handle, served.audit_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditId: served.audit_id,
      appId: h.appId,
      type: 'impression',
      meta: { slot: 1 },
    });
    expect(rows[0]?.id).toMatch(/^ev_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(rows[0]?.ts.toISOString()).toBe('2026-09-02T18:04:11.000Z');

    const lines = h.lines.filter((entry) => entry.includes('"msg":"event"'));
    expect(lines.map((line) => (JSON.parse(line) as { duplicate: boolean }).duplicate)).toEqual([
      false,
      true,
    ]);
  });

  it('stores click, dismiss and conversion rows in order, meta optional', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    for (const type of ['click', 'dismiss', 'conversion']) {
      const res = await postEvent({ audit_id: served.audit_id, type, ts: TS });
      expect(res.status).toBe(204);
    }
    const rows = await eventRows(h.handle, served.audit_id);
    expect(rows.map((row) => row.type)).toEqual(['click', 'dismiss', 'conversion']);
    expect(rows.every((row) => row.appId === h.appId)).toBe(true);
    expect(rows.map((row) => row.meta)).toEqual([{}, {}, {}]);
  });

  it('events for a suppressed turn are accepted too (an attested suppress needs dismiss/impression stats)', async () => {
    const suppressed = await h.evaluate(
      evaluateBody(h.appId, { user: { tier: 'paid', region: 'US' } }),
    );
    expect(suppressed.decision).toBe('suppress');
    expect((await postEvent(eventBody(suppressed.audit_id, 'impression'))).status).toBe(204);
    expect(await eventRows(h.handle, suppressed.audit_id)).toHaveLength(1);
  });

  it('rejects an audit_id of another app with 403 forbidden and writes nothing', async () => {
    const other = await registerApp(h.handle.db, { name: 'Other App' });
    const served = await h.evaluate(evaluateBody(h.appId));
    const res = await postEvent(eventBody(served.audit_id, 'impression'), other.key.api_key);
    expect(res.status).toBe(403);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe('forbidden');
    expect(await eventRows(h.handle, served.audit_id)).toHaveLength(0);
  });

  it('answers 404 not_found for an unknown audit id', async () => {
    const res = await postEvent(eventBody(UNKNOWN_AUDIT_ID, 'click'));
    expect(res.status).toBe(404);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe('not_found');
    expect(await eventRows(h.handle, UNKNOWN_AUDIT_ID)).toHaveLength(0);
  });

  it('attributes the row to the key’s app whatever the body claims', async () => {
    const other = await registerApp(h.handle.db, { name: 'Other App' });
    const served = await h.evaluate(evaluateBody(h.appId));
    const res = await postEvent(eventBody(served.audit_id, 'click', { app_id: other.app.id }));
    expect(res.status).toBe(204);
    const rows = await eventRows(h.handle, served.audit_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appId).toBe(h.appId);
  });

  it('rejects meta over 4 KB serialized with 400 invalid_request', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    const res = await postEvent(
      eventBody(served.audit_id, 'click', { meta: { blob: 'x'.repeat(4096) } }),
    );
    expect(res.status).toBe(400);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toContain('meta');
    expect(await eventRows(h.handle, served.audit_id)).toHaveLength(0);

    const fits = await postEvent(
      eventBody(served.audit_id, 'click', { meta: { blob: 'x'.repeat(4000) } }),
    );
    expect(fits.status).toBe(204);
  });

  it('rejects a malformed body with 400 invalid_request naming the path', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    const badType = await postEvent(eventBody(served.audit_id, 'view'));
    expect(badType.status).toBe(400);
    expect(ErrorResponse.parse(await badType.json()).error.message).toContain('type');

    const badTs = await postEvent(eventBody(served.audit_id, 'click', { ts: 'yesterday' }));
    expect(badTs.status).toBe(400);
    expect(ErrorResponse.parse(await badTs.json()).error.message).toContain('ts');

    const notJson = await postJson(h, '/v1/events', null, { raw: '[' });
    expect(notJson.status).toBe(400);
    expect(await eventRows(h.handle, served.audit_id)).toHaveLength(0);
  });

  it('requires an app key', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    const res = await postEvent(eventBody(served.audit_id, 'click'), null);
    expect(res.status).toBe(401);
  });
});
