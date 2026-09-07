import { advertisers, apps, creatives } from '@adgate/gateway/schema';
import { and, asc, desc, eq, isNull, or, type SQL } from 'drizzle-orm';

import type { AppScope } from './app-scope';
import {
  type AdvertiserOption,
  type AppOption,
  type CreativeFormValues,
  GLOBAL_CATALOG_VALUE,
} from './creative-issue';
import { type DashboardDb, dashboardDb } from './db';
import { appScopeCondition } from './scope-queries';

/**
 * The catalog reads: one row per creative with its advertiser and, when it is private, the app
 * that may serve it. SELECT only, through the read-only handle (lib/db.ts); the editor's writes
 * go through the server actions and lib/creative-store.ts.
 *
 * THE GLOBAL CATALOG STAYS GLOBAL. A creative with `app_id` null is shared inventory that every
 * app may serve, so every account sees it; a creative scoped to an app follows THAT app's owner.
 * The predicate is therefore `app_id is null OR the app is mine`, and it is inside the query, so
 * a member asking for another member's private creative by id gets the same null as for an id
 * that does not exist.
 *
 * Advertisers are global for the same reason the shared catalog is: an advertiser row is a name
 * and a domain that the global creatives already expose, and the editor needs the list to keep
 * one name per domain.
 *
 * The creatives table is small - a catalog, not a log - so these are plain joins with no
 * pagination. lib/metrics-queries.ts is where the queries that must not scan audit_records live.
 */

export interface CreativeRecord {
  id: string;
  advertiserId: string;
  advertiser: string;
  advertiserDomain: string;
  headline: string;
  body: string;
  cta: string;
  urlTemplate: string;
  targetCategories: string[];
  targetRegions: string[];
  keywords: string[];
  ecpm: number;
  /**
   * The demand source as the column stores it, narrowed rather than left as `string`: the
   * deliverability diagnostic (lib/deliverability.ts) judges on it, and a widened type here would
   * force a cast at every call site instead of a compile error at the one place it could be wrong.
   */
  source: CreativeSource;
  network: string | null;
  programId: string | null;
  active: boolean;
  /** Null = the global catalog every app may serve. */
  appId: string | null;
  /** The private catalog's app name, or null for the global catalog (or a deleted app). */
  appName: string | null;
  contentHash: string;
  updatedAt: Date;
}

/** The sources a creatives row may carry, from the table's own column type. */
export type CreativeSource = (typeof creatives.$inferSelect)['source'];

export const ALL_FILTER = 'all';
export const GLOBAL_SCOPE = 'global';

/** The three filter controls of /creatives. 'all' is what an unfiltered page asks for. */
export interface CreativeFilters {
  source: typeof ALL_FILTER | CreativeSource;
  active: typeof ALL_FILTER | 'active' | 'inactive';
  /** 'all', 'global' (app_id is null) or an app id. */
  scope: string;
}

const SOURCES: readonly CreativeSource[] = ['direct', 'affiliate', 'koah', 'gravity'];

const isSource = (value: string): value is CreativeSource =>
  (SOURCES as readonly string[]).includes(value);

export const DEFAULT_CREATIVE_FILTERS: CreativeFilters = {
  source: ALL_FILTER,
  active: ALL_FILTER,
  scope: ALL_FILTER,
};

const one = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * Query string to filters, forgivingly: anything unrecognised falls back to "all", so a hand
 * edited URL narrows the list or does nothing, and never errors.
 */
export const parseCreativeFilters = (
  params: Record<string, string | string[] | undefined>,
): CreativeFilters => {
  const source = one(params['source']);
  const active = one(params['active']);
  const scope = one(params['scope']);
  return {
    source: isSource(source) ? source : ALL_FILTER,
    active: active === 'active' || active === 'inactive' ? active : ALL_FILTER,
    scope: scope === '' ? ALL_FILTER : scope,
  };
};

/**
 * The visibility predicate: the shared catalog, plus the private catalogs of this scope's apps.
 * `undefined` for an admin, so the query stays the one this dashboard has always run.
 */
const visibleCreatives = (scope: AppScope): SQL | undefined => {
  const owned = appScopeCondition(scope);
  return owned === undefined ? undefined : or(isNull(creatives.appId), owned);
};

const filterConditions = (filters: CreativeFilters): SQL[] => {
  const conditions: SQL[] = [];
  if (filters.source !== ALL_FILTER) {
    conditions.push(eq(creatives.source, filters.source));
  }
  if (filters.active !== ALL_FILTER) {
    conditions.push(eq(creatives.active, filters.active === 'active'));
  }
  if (filters.scope === GLOBAL_SCOPE) {
    const scoped = isNull(creatives.appId);
    conditions.push(scoped);
  } else if (filters.scope !== ALL_FILTER) {
    conditions.push(eq(creatives.appId, filters.scope));
  }
  return conditions;
};

const selection = {
  id: creatives.id,
  advertiserId: creatives.advertiserId,
  advertiser: advertisers.name,
  advertiserDomain: advertisers.domain,
  headline: creatives.headline,
  body: creatives.body,
  cta: creatives.cta,
  urlTemplate: creatives.urlTemplate,
  targetCategories: creatives.targetCategories,
  targetRegions: creatives.targetRegions,
  keywords: creatives.keywords,
  ecpm: creatives.ecpm,
  source: creatives.source,
  network: creatives.network,
  programId: creatives.programId,
  active: creatives.active,
  appId: creatives.appId,
  appName: apps.name,
  contentHash: creatives.contentHash,
  updatedAt: creatives.updatedAt,
};

/** Every creative in scope the filters allow, most recently changed first. */
export const listCreatives = async (
  scope: AppScope,
  filters: CreativeFilters = DEFAULT_CREATIVE_FILTERS,
  db: DashboardDb = dashboardDb(),
): Promise<CreativeRecord[]> => {
  const conditions = [...filterConditions(filters), visibleCreatives(scope)].filter(
    (condition): condition is SQL => condition !== undefined,
  );
  const query = db
    .select(selection)
    .from(creatives)
    .innerJoin(advertisers, eq(creatives.advertiserId, advertisers.id))
    .leftJoin(apps, eq(creatives.appId, apps.id));
  const filtered = conditions.length === 0 ? query : query.where(and(...conditions));
  return filtered.orderBy(desc(creatives.updatedAt), desc(creatives.id));
};

/** One creative by id, or null - including when it is another account's private creative. */
export const getCreative = async (
  scope: AppScope,
  id: string,
  db: DashboardDb = dashboardDb(),
): Promise<CreativeRecord | null> => {
  const [row] = await db
    .select(selection)
    .from(creatives)
    .innerJoin(advertisers, eq(creatives.advertiserId, advertisers.id))
    .leftJoin(apps, eq(creatives.appId, apps.id))
    .where(and(eq(creatives.id, id), visibleCreatives(scope)))
    .limit(1);
  return row ?? null;
};

/** Every advertiser, for the editor's select and its one-name-per-domain check. */
export const listAdvertiserOptions = (
  db: DashboardDb = dashboardDb(),
): Promise<AdvertiserOption[]> =>
  db
    .select({ id: advertisers.id, name: advertisers.name, domain: advertisers.domain })
    .from(advertisers)
    .orderBy(asc(advertisers.name));

/**
 * The apps this scope may see, for the "private catalog of" select, the creatives scope filter
 * and the audit search's app filter. It is also the list a server action validates a submitted
 * app id against, so a member cannot attach a creative to somebody else's app.
 */
export const listAppOptions = (
  scope: AppScope,
  db: DashboardDb = dashboardDb(),
): Promise<AppOption[]> => {
  const base = db.select({ id: apps.id, name: apps.name }).from(apps);
  const owned = appScopeCondition(scope);
  const scoped = owned === undefined ? base : base.where(owned);
  return scoped.orderBy(asc(apps.name));
};

/**
 * A stored creative as the editor's inputs hold it: lists joined with ", ", numbers as text.
 * The page does this, not the client component, so the form stays a dumb renderer of strings.
 */
export const creativeFormValues = (record: CreativeRecord): CreativeFormValues => ({
  id: record.id,
  advertiserId: record.advertiserId,
  advertiserName: record.advertiser,
  advertiserDomain: record.advertiserDomain,
  headline: record.headline,
  body: record.body,
  cta: record.cta,
  urlTemplate: record.urlTemplate,
  targetCategories: record.targetCategories.join(', '),
  targetRegions: record.targetRegions.join(', '),
  keywords: record.keywords.join(', '),
  ecpm: String(record.ecpm),
  source: record.source,
  network: record.network ?? '',
  programId: record.programId ?? '',
  active: record.active,
  appId: record.appId ?? GLOBAL_CATALOG_VALUE,
});
