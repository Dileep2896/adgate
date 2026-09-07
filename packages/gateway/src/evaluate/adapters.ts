import {
  type Clock,
  createAffiliateAdapter,
  createDirectAdapter,
  createGravityAdapter,
  createKoahAdapter,
  type DemandAdapter,
} from '@adgateio/core';
import {
  AffiliateConfig,
  CatalogCreative,
  type GravityConfig,
  type KoahConfig,
  type PolicyConfig,
} from '@adgateio/schemas';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { DbOrTx } from '../db/client.js';
import { advertisers, type AppRow } from '../db/tables/apps.js';
import { creatives } from '../db/tables/catalog.js';

/**
 * The demand adapters of one evaluation, built from the app's effective policy: one adapter
 * per enabled demand entry, in policy order (mediate reads nothing from policy.demand). The
 * DirectAdapter and every AffiliateAdapter get the catalog: active creatives of the global
 * catalog (app_id null) plus the app's private ones, joined with their advertisers, loaded per
 * request because it is small and a stale copy could serve a creative that was just paused.
 * The AffiliateAdapter takes the app owner's AffiliateConfig from apps.affiliate_config
 * (none = every affiliate entry answers affiliate_not_configured). Koah and Gravity are the
 * config-driven stubs of docs/decisions.md item 10.
 */
export interface LoadedCatalog {
  creatives: CatalogCreative[];
  /** creative id -> advertisers.id, for the audit_records.advertiser_id reporting column. */
  advertiserIds: ReadonlyMap<string, string>;
}

export interface AdapterFactoryInput {
  app: AppRow;
  /** The effective (override-merged) policy. */
  policy: PolicyConfig;
  log: Logger;
}

export interface AdapterSet {
  adapters: DemandAdapter[];
  advertiserIds: ReadonlyMap<string, string>;
  /** The catalog the adapters were built over, for the no-fill deliverability warning. */
  catalog: CatalogCreative[];
  /** The app's validated AffiliateConfig, the same one every affiliate adapter received. */
  affiliateConfig: AffiliateConfig;
}

export interface AdapterFactory {
  build(input: AdapterFactoryInput): Promise<AdapterSet>;
}

export interface AdapterFactoryOptions {
  koah: KoahConfig;
  gravity: GravityConfig;
  now?: Clock | undefined;
}

interface CatalogRow {
  creative: typeof creatives.$inferSelect;
  advertiser: string;
  advertiserDomain: string;
}

/** The CatalogCreative shape of a joined row, before validation. */
const toCatalogCreative = (row: CatalogRow): unknown => ({
  id: row.creative.id,
  advertiser: row.advertiser,
  advertiser_domain: row.advertiserDomain,
  headline: row.creative.headline,
  body: row.creative.body,
  cta: row.creative.cta,
  url_template: row.creative.urlTemplate,
  target_categories: row.creative.targetCategories,
  target_regions: row.creative.targetRegions,
  keywords: row.creative.keywords,
  ecpm: row.creative.ecpm,
  source: row.creative.source,
  active: row.creative.active,
  ...(row.creative.network === null ? {} : { network: row.creative.network }),
  ...(row.creative.programId === null ? {} : { program_id: row.creative.programId }),
});

/** Active creatives the app may serve. A row the schema rejects is skipped with a warning. */
export const loadCatalog = async (
  db: DbOrTx,
  appId: string,
  log: Logger,
): Promise<LoadedCatalog> => {
  const rows = await db
    .select({
      creative: creatives,
      advertiser: advertisers.name,
      advertiserDomain: advertisers.domain,
    })
    .from(creatives)
    .innerJoin(advertisers, eq(creatives.advertiserId, advertisers.id))
    .where(
      and(eq(creatives.active, true), or(isNull(creatives.appId), eq(creatives.appId, appId))),
    );
  const catalog: CatalogCreative[] = [];
  const advertiserIds = new Map<string, string>();
  for (const row of rows) {
    const parsed = CatalogCreative.safeParse(toCatalogCreative(row));
    if (!parsed.success) {
      log.warn({ creative_id: row.creative.id }, 'creatives row is not a CatalogCreative; skipped');
      continue;
    }
    catalog.push(parsed.data);
    advertiserIds.set(row.creative.id, row.creative.advertiserId);
  }
  return { creatives: catalog, advertiserIds };
};

/**
 * apps.affiliate_config validated; an app without one gets an empty config (no networks). A
 * stored value the schema rejects is treated the same way with a warning naming the app (never
 * the value): every affiliate entry then answers affiliate_not_configured while direct demand
 * still serves, rather than the whole turn failing closed over one column.
 */
export const affiliateConfigOf = (
  app: Pick<AppRow, 'id' | 'affiliateConfig'>,
  log?: Logger | undefined,
): AffiliateConfig => {
  if (app.affiliateConfig === null) {
    return {};
  }
  const parsed = AffiliateConfig.safeParse(app.affiliateConfig);
  if (!parsed.success) {
    log?.warn({ app_id: app.id }, 'apps.affiliate_config is not an AffiliateConfig; ignored');
    return {};
  }
  return parsed.data;
};

/** One adapter per enabled demand entry, in policy order. */
export const createAdapters = (
  policy: PolicyConfig,
  catalog: readonly CatalogCreative[],
  affiliate: AffiliateConfig,
  options: AdapterFactoryOptions,
): DemandAdapter[] => {
  const now = options.now;
  const adapters: DemandAdapter[] = [];
  for (const entry of policy.demand) {
    if (!entry.enabled) {
      continue;
    }
    switch (entry.source) {
      case 'direct':
        adapters.push(createDirectAdapter(catalog, { now }));
        break;
      case 'affiliate':
        adapters.push(
          createAffiliateAdapter({ catalog, network: entry.network, config: affiliate, now }),
        );
        break;
      case 'koah':
        adapters.push(createKoahAdapter(options.koah, { now }));
        break;
      case 'gravity':
        adapters.push(createGravityAdapter(options.gravity, { now }));
        break;
    }
  }
  return adapters;
};

export const createAdapterFactory = (
  db: DbOrTx,
  options: AdapterFactoryOptions,
): AdapterFactory => ({
  async build({ app, policy, log }) {
    const catalog = await loadCatalog(db, app.id, log);
    const affiliateConfig = affiliateConfigOf(app, log);
    const adapters = createAdapters(policy, catalog.creatives, affiliateConfig, options);
    return {
      adapters,
      advertiserIds: catalog.advertiserIds,
      catalog: catalog.creatives,
      affiliateConfig,
    };
  },
});
