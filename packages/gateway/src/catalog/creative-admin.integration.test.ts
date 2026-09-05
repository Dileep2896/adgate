import type { SeedCreative } from '@adgate/schemas';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { advertisers } from '../db/tables/apps.js';
import { creatives } from '../db/tables/catalog.js';
import {
  auditRow,
  auditRowsInOrder,
  createHarness,
  evaluateBody,
  expectChecks,
  type Harness,
  storedCreativeHash,
  verifyRow,
} from '../evaluate/test-support.js';
import { createCreative, setCreativeActive, updateCreative } from './creative-admin.js';

/**
 * The two promises the dashboard's creative editor makes, proved through the real pipeline:
 *
 *  1. A creative created here is eligible IMMEDIATELY - the very next POST /v1/evaluate serves
 *    it, with a content_hash the verification check recomputes and agrees with. There is no
 *    cache to wait for: evaluate/adapters.ts loads the catalog per request.
 *  2. Deactivating it removes it from demand WITHOUT deleting anything: the audit record that
 *    served it is still there and still verifies afterwards.
 */

let h: Harness;

const DB_SEED: SeedCreative = {
  advertiser: 'Dashboard DB Cloud',
  advertiser_domain: 'dashboarddb.example',
  headline: 'Postgres, created from the dashboard',
  body: 'A creative an operator typed in, not a seed file.',
  cta: 'Start free',
  url_template: 'https://dashboarddb.example/?ref=adgate',
  target_categories: ['software.devtools.database'],
  target_regions: ['US'],
  keywords: ['postgres', 'database'],
  ecpm: 21,
  source: 'direct',
  active: true,
};

beforeAll(async () => {
  // No example catalog: the only creative in the database is the one this test creates.
  h = await createHarness({ seed: false });
}, 120_000);

afterAll(() => h.close());

describe('a creative created through createCreative', () => {
  let created: string;

  it('is served by the very next evaluate call', async () => {
    const result = await createCreative(h.handle.db, { seed: DB_SEED, appId: null });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    created = result.creative.id;
    expect(created).toMatch(/^cr_/);
    expect(result.creative.contentHash).toBe(await storedCreativeHash(h.handle, created));

    const res = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_serve' }));
    expect(res.decision).toBe('serve');
    expect(res.creative?.id).toBe(created);
    expect(res.creative?.headline).toBe(DB_SEED.headline);

    // The signed record's creative hash is the stored row's hash: verification agrees.
    const row = await auditRow(h.handle, res.audit_id);
    const stored = await storedCreativeHash(h.handle, created);
    expect(row.record.creative?.content_hash).toBe(stored);
    expectChecks(verifyRow(h, row, { prevRecord: null, storedCreativeHash: stored }), [
      'separation_attested',
    ]);
  });

  it('disappears from demand when it is deactivated, without losing the audit record', async () => {
    const served = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_before' }));
    expect(served.decision).toBe('serve');

    const paused = await setCreativeActive(h.handle.db, created, false);
    expect(paused?.active).toBe(false);

    const after = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_after' }));
    expect(after.decision).toBe('suppress');
    expect(after.reason).toBe('no_fill');
    expect(after.creative).toBeNull();

    // The row is paused, not deleted, and the record that served it still verifies against it.
    const [row] = await h.handle.db.select().from(creatives).where(eq(creatives.id, created));
    expect(row?.active).toBe(false);
    const record = await auditRow(h.handle, served.audit_id);
    expect(record.creativeId).toBe(created);
    const stored = await storedCreativeHash(h.handle, created);
    expect(stored).toBe(record.record.creative?.content_hash);
    const chain = await auditRowsInOrder(h.handle, h.appId);
    const position = chain.findIndex((entry) => entry.recordHash === record.recordHash);
    const prevRecord = position > 0 ? (chain[position - 1]?.record ?? null) : null;
    expectChecks(verifyRow(h, record, { prevRecord, storedCreativeHash: stored }), [
      'separation_attested',
    ]);

    await setCreativeActive(h.handle.db, created, true);
    const back = await h.evaluate(evaluateBody(h.appId, { conversation_id: 'conv_back' }));
    expect(back.decision).toBe('serve');
    expect(back.creative?.id).toBe(created);
  });

  it('changes content_hash when the copy changes, and says so in the row', async () => {
    const before = await storedCreativeHash(h.handle, created);
    const result = await updateCreative(h.handle.db, created, {
      seed: { ...DB_SEED, headline: 'Postgres, edited from the dashboard' },
      appId: null,
    });
    expect(result.ok).toBe(true);
    const after = await storedCreativeHash(h.handle, created);
    expect(after).not.toBe(before);
    if (result.ok) {
      expect(result.creative.contentHash).toBe(after);
    }
    // Put the original copy back for any later assertion in this file.
    await updateCreative(h.handle.db, created, { seed: DB_SEED, appId: null });
  });
});

describe('a write that would break a catalog rule', () => {
  const countRows = async (): Promise<[number, number]> => {
    const advertiserRows = await h.handle.db.select().from(advertisers);
    const creativeRows = await h.handle.db.select().from(creatives);
    return [advertiserRows.length, creativeRows.length];
  };

  it('refuses a second name for a known domain and writes nothing', async () => {
    const before = await countRows();
    const result = await createCreative(h.handle.db, {
      seed: { ...DB_SEED, advertiser: 'Renamed DB Cloud', headline: 'Another headline' },
      appId: null,
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'advertiser_name_conflict',
      domain: DB_SEED.advertiser_domain,
      name: DB_SEED.advertiser,
    });
    expect(await countRows()).toEqual(before);
  });

  it('refuses a duplicate (advertiser, headline) in the same catalog', async () => {
    const before = await countRows();
    const result = await createCreative(h.handle.db, { seed: DB_SEED, appId: null });
    expect(result).toMatchObject({ ok: false, error: 'duplicate_headline' });
    expect(await countRows()).toEqual(before);
  });

  it('allows the same headline in a different catalog', async () => {
    const result = await createCreative(h.handle.db, { seed: DB_SEED, appId: h.appId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.creative.appId).toBe(h.appId);
      await setCreativeActive(h.handle.db, result.creative.id, false);
    }
  });

  it('refuses an unknown app id and an unknown creative id', async () => {
    const before = await countRows();
    expect(
      await createCreative(h.handle.db, {
        seed: { ...DB_SEED, advertiser: 'Nowhere', advertiser_domain: 'nowhere.example' },
        appId: 'app_00000000000000000000000000',
      }),
    ).toMatchObject({ ok: false, error: 'app_not_found' });
    expect(
      await updateCreative(h.handle.db, 'cr_00000000000000000000000000', {
        seed: DB_SEED,
        appId: null,
      }),
    ).toMatchObject({ ok: false, error: 'creative_not_found' });
    expect(await countRows()).toEqual(before);
  });
});
