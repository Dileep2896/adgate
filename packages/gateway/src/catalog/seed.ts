import { creativeContentHash, creativeId, prefixedUlid, type UlidOptions } from '@adgate/core';
import { SeedCreative } from '@adgate/schemas';
import { and, eq, isNull } from 'drizzle-orm';

import type { Db, DbOrTx } from '../db/client.js';
import { advertisers, apps } from '../db/tables/apps.js';
import { creatives } from '../db/tables/catalog.js';

/**
 * Loads seed entries (examples/creatives.seed.json, SeedCreative shape) into advertisers and
 * creatives. Idempotent: advertisers are keyed by domain and creatives by
 * (advertiser, headline) within one catalog (app_id null = global, or the app named by
 * options.appId), so a re-run inserts nothing, updates only entries whose content changed
 * and keeps every id. Runs in one transaction: a bad entry leaves the tables untouched.
 */

export const ADVERTISER_ID_PREFIX = 'adv_';

export interface SeedCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface SeedResult {
  advertisers: SeedCounts;
  creatives: SeedCounts;
}

export interface SeedOptions {
  /** Private catalog of this app; null/undefined = the global catalog every app may serve. */
  appId?: string | null | undefined;
  ulid?: UlidOptions | undefined;
}

/** Every column of a creatives row that a seed entry decides. Exported for creative-admin.ts. */
export type CreativeValues = Omit<typeof creatives.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
export type CreativeRow = typeof creatives.$inferSelect;

const emptyCounts = (): SeedCounts => ({ inserted: 0, updated: 0, unchanged: 0 });

/** One name per domain, in first-seen order; two names for one domain is an authoring error. */
const distinctAdvertisers = (seeds: readonly SeedCreative[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const seed of seeds) {
    const known = names.get(seed.advertiser_domain);
    if (known !== undefined && known !== seed.advertiser) {
      throw new Error(
        `seedCreatives: advertiser domain ${seed.advertiser_domain} is named both "${known}" and "${seed.advertiser}"`,
      );
    }
    names.set(seed.advertiser_domain, seed.advertiser);
  }
  return names;
};

const upsertAdvertisers = async (
  tx: DbOrTx,
  names: Map<string, string>,
  counts: SeedCounts,
  ulid: UlidOptions | undefined,
): Promise<Map<string, string>> => {
  const ids = new Map<string, string>();
  for (const [domain, name] of names) {
    const [existing] = await tx.select().from(advertisers).where(eq(advertisers.domain, domain));
    if (existing === undefined) {
      const id = prefixedUlid(ADVERTISER_ID_PREFIX, ulid);
      await tx.insert(advertisers).values({ id, name, domain });
      ids.set(domain, id);
      counts.inserted += 1;
    } else {
      if (existing.name !== name) {
        await tx.update(advertisers).set({ name }).where(eq(advertisers.id, existing.id));
        counts.updated += 1;
      } else {
        counts.unchanged += 1;
      }
      ids.set(domain, existing.id);
    }
  }
  return ids;
};

/**
 * The row one seed entry describes, content_hash included. The dashboard's creative editor
 * (creative-admin.ts) writes rows through this same function, so a creative created by an
 * operator is byte for byte the row `seed-creatives` would have written.
 */
export const creativeValues = (
  seed: SeedCreative,
  advertiserId: string,
  appId: string | null,
): CreativeValues => ({
  advertiserId,
  appId,
  headline: seed.headline,
  body: seed.body,
  cta: seed.cta,
  urlTemplate: seed.url_template,
  targetCategories: [...seed.target_categories],
  targetRegions: [...seed.target_regions],
  keywords: [...seed.keywords],
  ecpm: seed.ecpm,
  source: seed.source,
  network: seed.network ?? null,
  programId: seed.program_id ?? null,
  active: seed.active,
  contentHash: creativeContentHash(seed),
});

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const creativeMatches = (row: CreativeRow, values: CreativeValues): boolean =>
  row.body === values.body &&
  row.cta === values.cta &&
  row.urlTemplate === values.urlTemplate &&
  sameList(row.targetCategories, values.targetCategories) &&
  sameList(row.targetRegions, values.targetRegions) &&
  sameList(row.keywords, values.keywords) &&
  row.ecpm === values.ecpm &&
  row.source === values.source &&
  row.network === values.network &&
  row.programId === values.programId &&
  row.active === values.active &&
  row.contentHash === values.contentHash;

const upsertCreative = async (
  tx: DbOrTx,
  values: CreativeValues,
  counts: SeedCounts,
  ulid: UlidOptions | undefined,
): Promise<void> => {
  const scope =
    values.appId === null || values.appId === undefined
      ? isNull(creatives.appId)
      : eq(creatives.appId, values.appId);
  const [existing] = await tx
    .select()
    .from(creatives)
    .where(
      and(
        eq(creatives.advertiserId, values.advertiserId),
        eq(creatives.headline, values.headline),
        scope,
      ),
    );
  if (existing === undefined) {
    await tx.insert(creatives).values({ id: creativeId(ulid), ...values });
    counts.inserted += 1;
  } else if (creativeMatches(existing, values)) {
    counts.unchanged += 1;
  } else {
    await tx
      .update(creatives)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(creatives.id, existing.id));
    counts.updated += 1;
  }
};

export const seedCreatives = async (
  db: Db,
  entries: readonly unknown[],
  options: SeedOptions = {},
): Promise<SeedResult> => {
  const seeds = SeedCreative.array().parse(entries);
  const appId = options.appId ?? null;
  const names = distinctAdvertisers(seeds);

  return db.transaction(async (tx) => {
    if (appId !== null) {
      const [app] = await tx.select({ id: apps.id }).from(apps).where(eq(apps.id, appId));
      if (app === undefined) {
        throw new Error(`seedCreatives: app not found: ${appId}`);
      }
    }
    const result: SeedResult = { advertisers: emptyCounts(), creatives: emptyCounts() };
    const advertiserIds = await upsertAdvertisers(tx, names, result.advertisers, options.ulid);
    for (const seed of seeds) {
      const advertiserId = advertiserIds.get(seed.advertiser_domain);
      if (advertiserId === undefined) {
        throw new Error(`seedCreatives: no advertiser id for ${seed.advertiser_domain}`);
      }
      await upsertCreative(
        tx,
        creativeValues(seed, advertiserId, appId),
        result.creatives,
        options.ulid,
      );
    }
    return result;
  });
};
