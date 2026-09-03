import { sha256Prefixed } from '@adgate/core';
import { ErrorResponse } from '@adgate/schemas';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { apps } from '../db/schema.js';
import {
  createHarness,
  evaluateBody,
  fixtureText,
  type Harness,
  TEXT,
} from '../evaluate/test-support.js';
import { eventRows, getClick, postJson } from '../test-support/routes.js';

/** GET /c/:audit_id (docs/api.md): a click event, then 302 to the resolved destination. */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

beforeEach(() => h.reset());

afterAll(() => h.close());

const UNKNOWN_AUDIT_ID = 'aud_01ARZ3NDEKTSV4RRFFQ69G5FAV';

const setAffiliateConfig = (config: { partnerstack: { program_id: string } } | null) =>
  h.handle.db.update(apps).set({ affiliateConfig: config }).where(eq(apps.id, h.appId));

const expectNotFound = async (res: Response): Promise<void> => {
  expect(res.status).toBe(404);
  expect(ErrorResponse.parse(await res.json()).error.code).toBe('not_found');
};

describe('GET /c/:audit_id', () => {
  it('302s a direct creative to its url_template and writes a click event for the record’s app', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    expect(served.creative?.source).toBe('direct');

    const res = await getClick(h, served.audit_id);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://exampledb.dev/?ref=adgate');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');

    const rows = await eventRows(h.handle, served.audit_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ auditId: served.audit_id, appId: h.appId, type: 'click' });
    expect(rows[0]?.id).toMatch(/^ev_/);

    const line = h.lines.find((entry) => entry.includes('"msg":"click"'));
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      audit_id: served.audit_id,
      app_id: h.appId,
      source: 'direct',
      via: 'template',
    });
    for (const entry of h.lines) {
      expect(entry).not.toContain('exampledb.dev/?ref');
    }
  });

  it('rebuilds an affiliate destination from the owner’s current config, else the landing page', async () => {
    await setAffiliateConfig({ partnerstack: { program_id: 'ps_owner_1' } });
    const served = await h.evaluate(evaluateBody(h.appId, { content: fixtureText('c019') }));
    expect(served.creative?.source).toBe('affiliate');

    const tracked = await getClick(h, served.audit_id);
    expect(tracked.status).toBe(302);
    expect(tracked.headers.get('location')).toBe(
      'https://partner.example/track?pid=ps_owner_1&u=https://examplelang.app',
    );

    // The destination is built at click time: a changed program id shows up immediately.
    await setAffiliateConfig({ partnerstack: { program_id: 'ps_owner_2' } });
    const rebuilt = await getClick(h, served.audit_id);
    expect(rebuilt.headers.get('location')).toBe(
      'https://partner.example/track?pid=ps_owner_2&u=https://examplelang.app',
    );

    await setAffiliateConfig(null);
    const fallback = await getClick(h, served.audit_id);
    expect(fallback.status).toBe(302);
    expect(fallback.headers.get('location')).toBe('https://examplelang.app/');

    const rows = await eventRows(h.handle, served.audit_id);
    expect(rows.map((row) => row.type)).toEqual(['click', 'click', 'click']);
    const vias = h.lines
      .filter((entry) => entry.includes('"msg":"click"'))
      .map((entry) => (JSON.parse(entry) as { via: string }).via);
    expect(vias).toEqual(['affiliate', 'affiliate', 'landing_page']);
  });

  it('follows the latest version of the record after attestation', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    const attested = await postJson(h, '/v1/attest', {
      audit_id: served.audit_id,
      model_output_hash: sha256Prefixed('answer'),
      rendered: true,
    });
    expect(attested.status).toBe(204);
    const res = await getClick(h, served.audit_id);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://exampledb.dev/?ref=adgate');
  });

  it('answers 404 not_found for a suppressed record, an unknown id and a malformed id, without an event', async () => {
    const suppressed = await h.evaluate(evaluateBody(h.appId, { content: TEXT.health }));
    expect(suppressed.creative).toBeNull();
    await expectNotFound(await getClick(h, suppressed.audit_id));
    expect(await eventRows(h.handle, suppressed.audit_id)).toHaveLength(0);

    await expectNotFound(await getClick(h, UNKNOWN_AUDIT_ID));
    await expectNotFound(await getClick(h, 'not-an-audit-id'));
    await expectNotFound(await getClick(h, 'aud_'));
    expect(await eventRows(h.handle, UNKNOWN_AUDIT_ID)).toHaveLength(0);
  });

  it('needs no API key: the audit id is the capability', async () => {
    const served = await h.evaluate(evaluateBody(h.appId));
    const res = await h.app.request(`/c/${served.audit_id}`, {
      method: 'GET',
      headers: { authorization: 'Bearer nonsense' },
    });
    expect(res.status).toBe(302);
  });
});
