import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { apps } from '../db/schema.js';
import { requireTestDatabaseUrl, truncateAllTables } from '../db/test-support.js';
import { affiliateConfigOf } from '../evaluate/adapters.js';
import { setAffiliateConfig } from './affiliate-config.js';
import { registerApp } from './register-app.js';

/**
 * The round trip that decides whether an affiliate link can be built: what the form writes has to
 * be exactly what the request path reads back. affiliateConfigOf() is the request path's own
 * reader, so it is what these assertions go through rather than a second parse.
 */

const url = requireTestDatabaseUrl();
let handle: DbHandle;
let appId: string;

const storedConfig = async (id: string) => {
  const [row] = await handle.db.select().from(apps).where(eq(apps.id, id));
  return row?.affiliateConfig ?? null;
};

beforeAll(async () => {
  await runMigrations(url);
  handle = createDb(url, { max: 2 });
  await truncateAllTables(handle.sql);
  const created = await registerApp(handle.db, { name: 'Affiliate app' });
  appId = created.app.id;
});

afterAll(async () => {
  await handle.close();
});

describe('setAffiliateConfig', () => {
  it('starts null: a freshly registered app has no affiliate network configured', async () => {
    expect(await storedConfig(appId)).toBeNull();
    expect(affiliateConfigOf({ id: appId, affiliateConfig: null })).toEqual({});
  });

  it('stores a full configuration the request path reads back unchanged', async () => {
    const config = {
      partnerstack: { program_id: 'ps-1' },
      impact: { program_id: 'imp-9', campaign_id: 'camp-3' },
      amazon: { tag: 'mysite-20', marketplace: 'co.uk' as const },
    };
    const result = await setAffiliateConfig(handle.db, appId, config);
    expect(result).toEqual({ ok: true, config });

    const stored = await storedConfig(appId);
    expect(stored).toEqual(config);
    // The reader the evaluate pipeline uses, not a second parse of our own.
    expect(affiliateConfigOf({ id: appId, affiliateConfig: stored })).toEqual(config);
  });

  it('bumps updated_at, so the app page shows the change happened', async () => {
    const [before] = await handle.db.select().from(apps).where(eq(apps.id, appId));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await setAffiliateConfig(handle.db, appId, { partnerstack: { program_id: 'ps-2' } });
    const [after] = await handle.db.select().from(apps).where(eq(apps.id, appId));
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? 0);
  });

  it('collapses an empty configuration to NULL rather than storing {}', async () => {
    // `{}` and NULL mean the same thing to the adapters, so "cleared" gets one representation.
    const result = await setAffiliateConfig(handle.db, appId, {});
    expect(result).toEqual({ ok: true, config: null });
    expect(await storedConfig(appId)).toBeNull();
  });

  it('treats an omitted configuration as clearing it', async () => {
    await setAffiliateConfig(handle.db, appId, { amazon: { tag: 'mysite-20' } });
    expect(await storedConfig(appId)).not.toBeNull();
    expect(await setAffiliateConfig(handle.db, appId, null)).toEqual({ ok: true, config: null });
    expect(await storedConfig(appId)).toBeNull();
  });

  it('refuses a config the contract rejects and writes NOTHING', async () => {
    await setAffiliateConfig(handle.db, appId, { partnerstack: { program_id: 'ps-keep' } });
    const before = await storedConfig(appId);

    for (const bad of [
      { partnerstack: { program_id: '' } },
      { partnerstack: { programme_id: 'typo' } },
      { amazon: { tag: 'mysite-20', marketplace: 'co.zz' } },
      { unknown_network: { program_id: 'x' } },
      'not an object',
    ]) {
      const result = await setAffiliateConfig(handle.db, appId, bad);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('invalid_config');
        expect(result.issues.length).toBeGreaterThan(0);
      }
    }
    expect(await storedConfig(appId)).toEqual(before);
  });

  it('never puts an identifier in the issues it reports', async () => {
    const result = await setAffiliateConfig(handle.db, appId, {
      amazon: { tag: 'mysite-20', marketplace: 'co.zz' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    for (const issue of result.issues) {
      expect(issue).not.toContain('mysite-20');
      expect(issue).not.toContain('co.zz');
    }
  });

  it('reports an unknown app instead of silently writing nothing', async () => {
    const result = await setAffiliateConfig(handle.db, 'app_00000000000000000000000000', {});
    expect(result).toEqual({ ok: false, error: 'app_not_found', issues: [] });
  });
});
