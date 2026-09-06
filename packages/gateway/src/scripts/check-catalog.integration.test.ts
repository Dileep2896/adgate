import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AffiliateConfig } from '@adgate/schemas';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerApp } from '../apps/register-app.js';
import { seedCreatives } from '../catalog/seed.js';
import { apps } from '../db/tables/apps.js';
import { findRepoRoot } from '../env-file.js';
import { createHarness, type Harness } from '../evaluate/test-support.js';
import { checkCatalog, renderCatalogReport } from './check-catalog.js';

/**
 * check-catalog against the test database, on the exact catalog that measured 26% fill:
 * examples/affiliate-catalog.seed.json, twelve affiliate creatives, eight on partnerstack and
 * four on impact. Under the default policy with no affiliate_config not one of them can serve,
 * and the two reasons are different.
 */

const root = findRepoRoot();
if (root === null) {
  throw new Error('repo root not found');
}
const affiliateSeeds: unknown = JSON.parse(
  readFileSync(join(root, 'examples', 'affiliate-catalog.seed.json'), 'utf8'),
);

const setAffiliateConfig = async (h: Harness, appId: string, config: AffiliateConfig) => {
  await h.handle.db.update(apps).set({ affiliateConfig: config }).where(eq(apps.id, appId));
};

describe('check-catalog', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness({ seed: false });
    await seedCreatives(h.handle.db, affiliateSeeds as unknown[]);
  });

  afterAll(async () => {
    await h.close();
  });

  it('reports the whole affiliate catalog as unservable for an app with no config', async () => {
    const [readiness, ...rest] = await checkCatalog(h.handle.db);
    expect(rest).toEqual([]);
    expect(readiness?.app_id).toBe(h.appId);
    expect(readiness?.total).toBe(12);
    expect(readiness?.deliverable).toBe(0);
    expect(readiness?.blocked.map((group) => [group.reason, group.count])).toEqual([
      ['affiliate_not_configured', 8],
      ['network_not_enabled', 4],
    ]);
  });

  it('unblocks the eight partnerstack creatives the moment a config exists', async () => {
    await setAffiliateConfig(h, h.appId, { partnerstack: { program_id: 'ps_live' } });
    const [readiness] = await checkCatalog(h.handle.db, h.appId);
    expect(readiness?.deliverable).toBe(8);
    expect(readiness?.blocked).toHaveLength(1);
    expect(readiness?.blocked[0]).toMatchObject({ reason: 'network_not_enabled', count: 4 });
  });

  it('renders a yes/no row per creative and never exits non-zero', async () => {
    const text = renderCatalogReport(await checkCatalog(h.handle.db, h.appId));
    expect(text).toContain(`${h.appId} (Evaluate Test App): 8 of 12 creatives can serve`);
    expect(text.match(/^ {4}yes {2}cr_/gm)).toHaveLength(8);
    expect(text.match(/^ {4}no {3}cr_/gm)).toHaveLength(4);
    expect(text).toContain('4 blocked: network_not_enabled');
    expect(text).toContain('impact');
    expect(process.exitCode).toBeUndefined();
  });

  it('judges each app against its own policy in the same run', async () => {
    const impactApp = await registerApp(h.handle.db, {
      name: 'Impact App',
      policyYaml: [
        'version: 1',
        'app_id: impact-app',
        'demand:',
        '  - source: affiliate',
        '    network: partnerstack',
        '    enabled: true',
        '  - source: affiliate',
        '    network: impact',
        '    enabled: true',
        '',
      ].join('\n'),
    });
    await setAffiliateConfig(h, impactApp.app.id, {
      partnerstack: { program_id: 'ps_live' },
      impact: { program_id: 'im_live' },
    });
    const all = await checkCatalog(h.handle.db);
    expect(all).toHaveLength(2);
    const byId = new Map(all.map((entry) => [entry.app_id, entry]));
    // The same twelve global creatives, two answers.
    expect(byId.get(h.appId)?.deliverable).toBe(8);
    expect(byId.get(impactApp.app.id)?.deliverable).toBe(12);
    expect(byId.get(impactApp.app.id)?.blocked).toEqual([]);
  });

  it('reports an app whose stored policy no longer parses instead of throwing', async () => {
    const broken = await registerApp(h.handle.db, { name: 'Broken App' });
    await h.handle.db
      .update(apps)
      .set({ policyYaml: 'version: 1\napp_id: x\nnope: true\n' })
      .where(eq(apps.id, broken.app.id));
    const all = await checkCatalog(h.handle.db, broken.app.id);
    expect(all[0]?.error).toContain('unreadable');
    expect(renderCatalogReport(all)).toContain('unreadable');
  });
});
