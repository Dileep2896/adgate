import { appReadiness, type AppReadiness, type CatalogApp } from '@adgate/gateway/admin';
import { apps, creatives } from '@adgate/gateway/schema';
import {
  AffiliateNetwork,
  DELIVERABILITY_REASONS,
  type DeliverabilityReason,
} from '@adgate/schemas';
import { and, asc, eq, isNull, or } from 'drizzle-orm';

import type { AppScope } from './app-scope';
import { type DashboardDb, dashboardDb } from './db';
import { appScopeCondition } from './scope-queries';

/**
 * WHY A CREATIVE THAT LOOKS HEALTHY NEVER SERVES, for the three screens that show a creative.
 *
 * The decision is not made here: it is `creativeDeliverability()` in @adgate/core, reached
 * through the gateway's own `appReadiness()` (packages/gateway/src/catalog/readiness.ts), which
 * is the SAME function `check-catalog` and `seed-creatives` print. That is deliberate - the
 * `detail` sentence an operator reads in the dashboard is byte-identical to the one the CLI
 * prints, so there is one vocabulary and not two. This module only loads the rows, judges each
 * (creative, app) pair and shapes the answer for a page.
 *
 * SERVER ONLY. It reaches @adgate/core through @adgate/gateway/admin (zod, the YAML parser, the
 * policy schema), so every function here runs on the server and the pages pass PLAIN DATA down
 * to the components. Nothing in this file may be imported by a client component.
 *
 * "DELIVERABLE" IS PER (CREATIVE, APP). A creative in the shared catalog is judged against every
 * app the session can see, and it can be deliverable for one and blocked for another - one app's
 * policy enables the impact network, another's does not. That is why the list page shows a count
 * ("blocked for 2 of 3 apps") and the creative's own page shows the breakdown.
 */

/** The creative columns the diagnostic reads. CreativeRecord from lib/creative-queries satisfies it. */
export interface DeliverabilityRow {
  id: string;
  active: boolean;
  source: 'direct' | 'affiliate' | 'koah' | 'gravity';
  network: string | null;
  targetCategories: string[];
  targetRegions: string[];
  /** Null = the shared catalog, judged against every app in scope. */
  appId: string | null;
}

/** One app's verdict on one creative. */
export interface CreativeAppDelivery {
  appId: string;
  appName: string;
  deliverable: boolean;
  /**
   * The first blocking reason, or null - which means either "nothing blocks it" (deliverable) or
   * "this app's stored policy will not parse", in which case `detail` says so.
   */
  reason: DeliverabilityReason | null;
  /** The sentence naming the change that unblocks it, exactly as check-catalog prints it. */
  detail: string | null;
}

export interface CreativeDelivery {
  /** How many apps judged it: one for a private creative, every app in scope for a global one. */
  judged: number;
  blocked: number;
  /** The verdict to act on first. Null when nothing blocks it anywhere. */
  worst: CreativeAppDelivery | null;
  /** Every verdict, in app-name order, for the creative's own page. */
  perApp: CreativeAppDelivery[];
}

const NOTHING: CreativeDelivery = { judged: 0, blocked: 0, worst: null, perApp: [] };

/** The apps columns the diagnostic needs. No salt, no keys: none of this is a secret. */
const APP_COLUMNS = {
  id: apps.id,
  name: apps.name,
  policyYaml: apps.policyYaml,
  affiliateConfig: apps.affiliateConfig,
};

/** The creative columns, in the shape appReadiness() judges. */
const CREATIVE_COLUMNS = {
  id: creatives.id,
  active: creatives.active,
  source: creatives.source,
  network: creatives.network,
  targetCategories: creatives.targetCategories,
  targetRegions: creatives.targetRegions,
  appId: creatives.appId,
};

/**
 * The apps this scope may see, with their policy and affiliate config. Ordered by name so the
 * per-app breakdown on a creative's page is stable between reloads.
 */
export const listReadinessApps = (
  scope: AppScope,
  db: DashboardDb = dashboardDb(),
): Promise<CatalogApp[]> => {
  const base = db.select(APP_COLUMNS).from(apps);
  const owned = appScopeCondition(scope);
  const scoped = owned === undefined ? base : base.where(owned);
  return scoped.orderBy(asc(apps.name), asc(apps.id));
};

/**
 * The creatives one app could serve: the shared catalog plus its own private rows, INACTIVE ONES
 * INCLUDED - "it is active but never serves" and "somebody paused it" are the two answers a
 * developer is choosing between. The same rule as the gateway's loadCatalogEntries.
 *
 * No scope predicate of its own: `appId` must already be an app this session may read, which is
 * what appDemandReadiness() below establishes before it calls this.
 */
const appCatalogRows = (
  appId: string,
  db: DashboardDb = dashboardDb(),
): Promise<DeliverabilityRow[]> =>
  db
    .select(CREATIVE_COLUMNS)
    .from(creatives)
    .where(or(isNull(creatives.appId), eq(creatives.appId, appId)))
    .orderBy(asc(creatives.id));

/** A stored row as the pure diagnostic wants it. The label is the creative id, so results key. */
const readinessEntry = (creative: DeliverabilityRow) => ({
  label: creative.id,
  creative: {
    active: creative.active,
    source: creative.source,
    // A `network` the schema does not know reads as "no network", which is how the affiliate
    // adapter treats it too: the creative belongs to whichever network the policy names.
    network: AffiliateNetwork.safeParse(creative.network).data,
    target_categories: creative.targetCategories,
    target_regions: creative.targetRegions,
  },
});

/**
 * Documented reason order, which is also the order an operator fixes things in. A policy that
 * will not parse (reason null) sorts FIRST: nothing about that app can be judged until it does.
 */
const reasonRank = (reason: DeliverabilityReason | null): number =>
  reason === null ? -1 : DELIVERABILITY_REASONS.indexOf(reason);

const summarise = (perApp: CreativeAppDelivery[]): CreativeDelivery => {
  const blocked = perApp.filter((entry) => !entry.deliverable);
  const worst = [...blocked].sort((a, b) => reasonRank(a.reason) - reasonRank(b.reason))[0] ?? null;
  return { judged: perApp.length, blocked: blocked.length, worst, perApp };
};

/**
 * Every (creative, app) verdict, keyed by creative id. Pure: the two arguments are exactly what
 * the queries above return, so a unit test drives it without a database.
 *
 * A creative always gets an entry, even when no app judged it - a member with no apps yet still
 * sees the shared catalog, and "nothing has judged this" is a different fact from "it is fine".
 */
export const deliveryIndex = (
  rows: readonly DeliverabilityRow[],
  scopedApps: readonly CatalogApp[],
): Map<string, CreativeDelivery> => {
  const verdicts = new Map<string, CreativeAppDelivery[]>(rows.map((row) => [row.id, []]));
  const record = (id: string, verdict: CreativeAppDelivery): void => {
    verdicts.get(id)?.push(verdict);
  };

  for (const app of scopedApps) {
    const mine = rows.filter((row) => row.appId === null || row.appId === app.id);
    if (mine.length === 0) {
      continue;
    }
    const readiness = appReadiness(app, mine.map(readinessEntry));
    const base = { appId: app.id, appName: app.name };
    if (readiness.error !== null) {
      // A stored policy that no longer parses blocks the whole app, and appReadiness returns no
      // rows for it. Saying so per creative beats dropping them silently from the count.
      for (const row of mine) {
        record(row.id, { ...base, deliverable: false, reason: null, detail: readiness.error });
      }
      continue;
    }
    for (const row of readiness.rows) {
      record(row.label, {
        ...base,
        deliverable: row.result.deliverable,
        reason: row.result.deliverable ? null : row.result.reason,
        detail: row.result.deliverable ? null : row.result.detail,
      });
    }
  }

  return new Map([...verdicts].map(([id, perApp]) => [id, summarise(perApp)]));
};

/** The verdict for one creative, for a caller that only holds one. */
export const deliveryOf = (
  index: ReadonlyMap<string, CreativeDelivery>,
  creativeId: string,
): CreativeDelivery => index.get(creativeId) ?? NOTHING;

/**
 * Verdicts for the creatives a page is showing. ONE extra query (the apps in scope); the
 * creatives were loaded by the page already, and the judging itself is pure.
 */
export const creativeDelivery = async (
  scope: AppScope,
  rows: readonly DeliverabilityRow[],
  db: DashboardDb = dashboardDb(),
): Promise<Map<string, CreativeDelivery>> =>
  deliveryIndex(rows, rows.length === 0 ? [] : await listReadinessApps(scope, db));

/**
 * How much of its catalog one app can actually serve, in the exact shape `check-catalog` prints:
 * `deliverable` of `total`, plus the blocked creatives grouped by (reason, detail) with the
 * biggest group first.
 *
 * Null when this scope may not read the app, which is the same answer it gets for an app id that
 * was never registered - the app id is not a capability.
 */
export const appDemandReadiness = async (
  scope: AppScope,
  appId: string,
  db: DashboardDb = dashboardDb(),
): Promise<AppReadiness | null> => {
  const [app] = await db
    .select(APP_COLUMNS)
    .from(apps)
    .where(and(eq(apps.id, appId), appScopeCondition(scope)))
    .limit(1);
  if (app === undefined) {
    return null;
  }
  const rows = await appCatalogRows(appId, db);
  return appReadiness(app, rows.map(readinessEntry));
};
