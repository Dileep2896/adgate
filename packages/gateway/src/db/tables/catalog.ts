import type { DemandSource } from '@adgate/schemas';
import { sql } from 'drizzle-orm';
import { boolean, check, index, numeric, pgTable, text } from 'drizzle-orm/pg-core';

import { advertisers, apps } from './apps.js';
import { createdAt, sqlList, updatedAt } from './columns.js';

/**
 * The creative catalog that DirectAdapter and AffiliateAdapter read (CatalogCreative in
 * @adgate/schemas). A row plus its advertiser's name and domain is one CatalogCreative.
 * Type-only contract import (see audit.ts); schema.test.ts pins CREATIVE_SOURCES to
 * DemandSource.options.
 */

export const CREATIVE_SOURCES = [
  'direct',
  'affiliate',
  'koah',
  'gravity',
] as const satisfies readonly DemandSource[];

export const creatives = pgTable(
  'creatives',
  {
    id: text('id').primaryKey(),
    advertiserId: text('advertiser_id')
      .notNull()
      .references(() => advertisers.id),
    /** Null = the global catalog every app may serve; set = private to that app. */
    appId: text('app_id').references(() => apps.id),
    headline: text('headline').notNull(),
    body: text('body').notNull().default(''),
    cta: text('cta').notNull(),
    urlTemplate: text('url_template').notNull(),
    targetCategories: text('target_categories').array().notNull(),
    targetRegions: text('target_regions').array().notNull(),
    keywords: text('keywords').array().notNull(),
    ecpm: numeric('ecpm', { precision: 12, scale: 4, mode: 'number' }).notNull(),
    source: text('source', { enum: CREATIVE_SOURCES }).notNull(),
    /** Affiliate network of an affiliate creative; null = the policy's entry decides. */
    network: text('network'),
    /** Per-creative affiliate program id override (S10). */
    programId: text('program_id'),
    active: boolean('active').notNull().default(true),
    /** creativeContentHash() over the joined row; verify recomputes and compares it. */
    contentHash: text('content_hash').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('creatives_advertiser_id_idx').on(table.advertiserId),
    index('creatives_app_id_idx').on(table.appId),
    check('creatives_source_check', sql`${table.source} in (${sqlList(CREATIVE_SOURCES)})`),
    check('creatives_ecpm_check', sql`${table.ecpm} >= 0`),
  ],
);
