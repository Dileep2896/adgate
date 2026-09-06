import {
  creativeDeliverability,
  type DeliverabilityCreative,
  loadPolicyFromYaml,
} from '@adgate/core';
import {
  type AffiliateConfig,
  AffiliateNetwork,
  type CreativeDeliverability,
  DELIVERABILITY_REASONS,
  type DeliverabilityReason,
  type PolicyConfig,
} from '@adgate/schemas';
import { asc, eq, isNull, or } from 'drizzle-orm';

import type { DbOrTx } from '../db/client.js';
import { advertisers, apps } from '../db/tables/apps.js';
import { creatives } from '../db/tables/catalog.js';
import { affiliateConfigOf } from '../evaluate/adapters.js';

/**
 * Catalog readiness: for one app, which creatives can actually serve and why the rest cannot.
 * The decision is creativeDeliverability() in @adgate/core; this file only loads the rows,
 * groups the failures and renders them for the two operator-facing scripts (seed-creatives
 * prints it right after seeding, check-catalog prints it on demand). Read-only; it never
 * writes and never exits non-zero, because a blocked creative is a configuration fact, not a
 * failure of the command that reported it.
 */

/** The apps columns readiness needs; nothing here is a secret (no salt, no key material). */
export interface CatalogApp {
  id: string;
  name: string;
  policyYaml: string;
  /** apps.affiliate_config as stored; validated here, never trusted. */
  affiliateConfig: AffiliateConfig | null;
}

/** One creative to judge, with the label the table prints for it. */
export interface ReadinessCreative {
  /** A cr_ id for a stored creative, or the advertiser name for a seed entry with no id yet. */
  label: string;
  creative: DeliverabilityCreative;
}

export interface ReadinessRow {
  label: string;
  result: CreativeDeliverability;
}

/** Creatives that failed for the same reason with the same explanation, counted. */
export interface BlockedGroup {
  reason: DeliverabilityReason;
  detail: string;
  count: number;
}

export interface AppReadiness {
  app_id: string;
  app_name: string;
  /** Set when the stored policy YAML no longer parses; then `rows` is empty. */
  error: string | null;
  total: number;
  deliverable: number;
  rows: ReadinessRow[];
  blocked: BlockedGroup[];
}

const reasonOrder = (reason: DeliverabilityReason): number =>
  DELIVERABILITY_REASONS.indexOf(reason);

/** Distinct (reason, detail) pairs, most creatives first, then documented reason order. */
export const groupBlocked = (rows: readonly ReadinessRow[]): BlockedGroup[] => {
  const groups = new Map<string, BlockedGroup>();
  for (const row of rows) {
    if (row.result.deliverable) {
      continue;
    }
    const { reason, detail } = row.result;
    const key = `${reason}\n${detail}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { reason, detail, count: 1 });
    } else {
      existing.count += 1;
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.count - a.count ||
      reasonOrder(a.reason) - reasonOrder(b.reason) ||
      (a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0),
  );
};

/**
 * Judges every creative against one app's stored policy and affiliate config. An app whose
 * policy no longer parses is reported with `error` and no rows, the way the retention job
 * skips such an app: a broken document is the operator's next problem, not a crash here.
 */
export const appReadiness = (
  app: CatalogApp,
  entries: readonly ReadinessCreative[],
): AppReadiness => {
  const base = { app_id: app.id, app_name: app.name, total: entries.length };
  let policy: PolicyConfig;
  try {
    policy = loadPolicyFromYaml(app.policyYaml).policy;
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return {
      ...base,
      error: `stored policy is unreadable (${name})`,
      deliverable: 0,
      rows: [],
      blocked: [],
    };
  }
  const affiliateConfig = affiliateConfigOf(app);
  const rows = entries.map((entry) => ({
    label: entry.label,
    result: creativeDeliverability(entry.creative, { policy, affiliateConfig }),
  }));
  return {
    ...base,
    error: null,
    deliverable: rows.filter((row) => row.result.deliverable).length,
    rows,
    blocked: groupBlocked(rows),
  };
};

/** Every app, oldest id first, or just the one named. */
export const loadCatalogApps = async (
  db: DbOrTx,
  appId: string | null = null,
): Promise<CatalogApp[]> => {
  const columns = {
    id: apps.id,
    name: apps.name,
    policyYaml: apps.policyYaml,
    affiliateConfig: apps.affiliateConfig,
  };
  const query = db.select(columns).from(apps);
  return appId === null
    ? query.orderBy(asc(apps.id))
    : query.where(eq(apps.id, appId)).orderBy(asc(apps.id));
};

/**
 * The creatives one app could serve: the global catalog (app_id null) plus its own private
 * rows, INACTIVE ONES INCLUDED, because "it is active but never serves" and "someone paused it"
 * are the two answers an operator is choosing between. Ordered by advertiser then id so the
 * table is stable across runs.
 */
export const loadCatalogEntries = async (
  db: DbOrTx,
  appId: string,
): Promise<ReadinessCreative[]> => {
  const rows = await db
    .select({
      id: creatives.id,
      advertiser: advertisers.name,
      source: creatives.source,
      network: creatives.network,
      targetCategories: creatives.targetCategories,
      targetRegions: creatives.targetRegions,
      active: creatives.active,
    })
    .from(creatives)
    .innerJoin(advertisers, eq(creatives.advertiserId, advertisers.id))
    .where(or(isNull(creatives.appId), eq(creatives.appId, appId)))
    .orderBy(asc(advertisers.name), asc(creatives.id));
  return rows.map((row) => ({
    label: `${row.id}  ${row.advertiser}`,
    creative: {
      active: row.active,
      source: row.source,
      network: AffiliateNetwork.safeParse(row.network).data,
      target_categories: row.targetCategories,
      target_regions: row.targetRegions,
    },
  }));
};

/** `  4 blocked: network_not_enabled - <detail naming the fix>`, one line per group. */
export const blockedLines = (readiness: AppReadiness, indent = '    '): string[] =>
  readiness.blocked.map(
    (group) => `${indent}${String(group.count)} blocked: ${group.reason} - ${group.detail}`,
  );

/** `app_x (Name): 8 of 12 creatives can serve` plus one line per blocked group. */
export const readinessLines = (readiness: AppReadiness, indent = '  '): string[] => {
  if (readiness.error !== null) {
    return [`${indent}${readiness.app_id} (${readiness.app_name}): ${readiness.error}`];
  }
  const head = `${indent}${readiness.app_id} (${readiness.app_name}): ${String(readiness.deliverable)} of ${String(readiness.total)} creatives can serve`;
  return [head, ...blockedLines(readiness, `${indent}  `)];
};
