import { creativeContentHash } from '@adgateio/core';
import { SeedCreative } from '@adgateio/schemas';
import { asc } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerApp } from '../apps/register-app.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { advertisers, creatives } from '../db/schema.js';
import { requireTestDatabaseUrl, truncateAllTables } from '../db/test-support.js';
import { findRepoRoot } from '../env-file.js';
import { seedCreatives } from './seed.js';

const url = requireTestDatabaseUrl();
let handle: DbHandle;

const root = findRepoRoot();
if (root === null) {
  throw new Error('repo root not found');
}
const SEED_FILE = join(root, 'examples', 'creatives.seed.json');
const seeds = SeedCreative.array().parse(JSON.parse(readFileSync(SEED_FILE, 'utf8')));

const snapshot = async () => ({
  advertisers: await handle.db.select().from(advertisers).orderBy(asc(advertisers.domain)),
  creatives: await handle.db.select().from(creatives).orderBy(asc(creatives.headline)),
});

beforeAll(async () => {
  await runMigrations(url);
  handle = createDb(url, { max: 2 });
});

beforeEach(async () => {
  await truncateAllTables(handle.sql);
});

afterAll(async () => {
  await handle.close();
});

describe('seedCreatives', () => {
  it('inserts the example catalog with cr_/adv_ ids and content hashes on the first run', async () => {
    const result = await seedCreatives(handle.db, seeds);
    expect(result).toEqual({
      advertisers: { inserted: 3, updated: 0, unchanged: 0 },
      creatives: { inserted: 3, updated: 0, unchanged: 0 },
    });
    const { advertisers: advRows, creatives: crRows } = await snapshot();
    expect(advRows.map((row) => row.domain)).toEqual([
      'exampledb.dev',
      'exampledeploy.dev',
      'examplelang.app',
    ]);
    for (const row of advRows) {
      expect(row.id).toMatch(/^adv_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    }
    expect(crRows).toHaveLength(3);
    for (const row of crRows) {
      const seed = seeds.find((entry) => entry.headline === row.headline);
      const advertiser = advRows.find((entry) => entry.id === row.advertiserId);
      if (seed === undefined || advertiser === undefined) {
        throw new Error(`unexpected row ${row.headline}`);
      }
      expect(row.id).toMatch(/^cr_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      expect(advertiser.domain).toBe(seed.advertiser_domain);
      expect(advertiser.name).toBe(seed.advertiser);
      expect(row.appId).toBeNull();
      expect(row.contentHash).toBe(creativeContentHash(seed));
      expect(row.contentHash).toBe(
        creativeContentHash({
          advertiser: advertiser.name,
          advertiser_domain: advertiser.domain,
          headline: row.headline,
          body: row.body,
          cta: row.cta,
          url_template: row.urlTemplate,
        }),
      );
      expect(row.targetCategories).toEqual(seed.target_categories);
      expect(row.targetRegions).toEqual(seed.target_regions);
      expect(row.keywords).toEqual(seed.keywords);
      expect(row.ecpm).toBe(seed.ecpm);
      expect(row.source).toBe(seed.source);
      expect(row.active).toBe(seed.active);
      expect(row.network).toBe(seed.network ?? null);
      expect(row.programId).toBe(seed.program_id ?? null);
    }
  });

  it('is a no-op on the second run: same counts, ids, hashes and timestamps', async () => {
    await seedCreatives(handle.db, seeds);
    const before = await snapshot();
    const result = await seedCreatives(handle.db, seeds);
    expect(result).toEqual({
      advertisers: { inserted: 0, updated: 0, unchanged: 3 },
      creatives: { inserted: 0, updated: 0, unchanged: 3 },
    });
    expect(await snapshot()).toEqual(before);
  });

  it('updates a changed entry in place, keeping its id', async () => {
    await seedCreatives(handle.db, seeds);
    const before = await snapshot();
    const [first, ...rest] = seeds;
    if (first === undefined) {
      throw new Error('seed file is empty');
    }
    const changed = { ...first, body: 'New body copy.', advertiser: 'Example DB Cloud, Inc.' };
    const result = await seedCreatives(handle.db, [changed, ...rest]);
    expect(result).toEqual({
      advertisers: { inserted: 0, updated: 1, unchanged: 2 },
      creatives: { inserted: 0, updated: 1, unchanged: 2 },
    });
    const after = await snapshot();
    expect(after.creatives).toHaveLength(3);
    const row = after.creatives.find((entry) => entry.headline === first.headline);
    const previous = before.creatives.find((entry) => entry.headline === first.headline);
    expect(row?.id).toBe(previous?.id);
    expect(row?.body).toBe('New body copy.');
    expect(row?.contentHash).toBe(creativeContentHash(changed));
    expect(row?.contentHash).not.toBe(previous?.contentHash);
    expect(row?.updatedAt.getTime()).toBeGreaterThan(previous?.updatedAt.getTime() ?? Infinity);
    const advertiser = after.advertisers.find((entry) => entry.domain === first.advertiser_domain);
    expect(advertiser?.name).toBe('Example DB Cloud, Inc.');
    expect(advertiser?.id).toBe(
      before.advertisers.find((entry) => entry.domain === first.advertiser_domain)?.id,
    );
  });

  it('keeps network and program_id when the seed carries them', async () => {
    const affiliate = seeds.find((entry) => entry.source === 'affiliate');
    if (affiliate === undefined) {
      throw new Error('no affiliate seed');
    }
    await seedCreatives(handle.db, [{ ...affiliate, network: 'impact', program_id: 'prog_9' }]);
    const { creatives: rows } = await snapshot();
    expect(rows[0]?.network).toBe('impact');
    expect(rows[0]?.programId).toBe('prog_9');
  });

  it('scopes a private catalog to the app and keeps it apart from the global one', async () => {
    await seedCreatives(handle.db, seeds);
    const { app } = await registerApp(handle.db, { name: 'Seed App' });
    const first = await seedCreatives(handle.db, seeds, { appId: app.id });
    expect(first.creatives).toEqual({ inserted: 3, updated: 0, unchanged: 0 });
    expect(first.advertisers).toEqual({ inserted: 0, updated: 0, unchanged: 3 });
    const again = await seedCreatives(handle.db, seeds, { appId: app.id });
    expect(again.creatives).toEqual({ inserted: 0, updated: 0, unchanged: 3 });
    const { creatives: rows } = await snapshot();
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.appId === app.id)).toHaveLength(3);
    expect(rows.filter((row) => row.appId === null)).toHaveLength(3);
  });

  it('rejects two names for one advertiser domain and writes nothing', async () => {
    const [first] = seeds;
    if (first === undefined) {
      throw new Error('seed file is empty');
    }
    const renamed = { ...first, headline: 'Another headline', advertiser: 'Renamed Corp' };
    await expect(seedCreatives(handle.db, [first, renamed])).rejects.toThrow(
      `advertiser domain ${first.advertiser_domain} is named both "${first.advertiser}" and "Renamed Corp"`,
    );
    const { advertisers: advRows, creatives: crRows } = await snapshot();
    expect(advRows).toHaveLength(0);
    expect(crRows).toHaveLength(0);
  });

  it('rejects an unknown app id and an invalid entry without inserting anything', async () => {
    await expect(seedCreatives(handle.db, seeds, { appId: 'app_missing' })).rejects.toThrow(
      /app_missing/,
    );
    await expect(
      seedCreatives(handle.db, [{ ...seeds[0], ecpm: -1 } as unknown as SeedCreative]),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(seedCreatives(handle.db, [{ headline: 'x' }] as unknown[])).rejects.toBeInstanceOf(
      ZodError,
    );
    const { advertisers: advRows, creatives: crRows } = await snapshot();
    expect(advRows).toHaveLength(0);
    expect(crRows).toHaveLength(0);
  });
});
