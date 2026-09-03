import type { AffiliateConfig } from '@adgate/schemas';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, sqlList, timestamptz, updatedAt } from './columns.js';

/**
 * Tenants and their credentials. Ids are prefixed ULIDs (app_, key_, adv_) minted by the
 * application with prefixedUlid, never by the database.
 */

export const API_KEY_ROLES = ['app', 'advertiser_read'] as const;
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];

export const apps = pgTable('apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Per-app secret that salts conversation and user hashes (docs/audit.md). Never in a record. */
  salt: text('salt').notNull(),
  /** The stored policy as the operator wrote it (docs/policy.md). */
  policyYaml: text('policy_yaml').notNull(),
  /** policyHash() of the fully defaulted policy; written into every audit record. */
  policyHash: text('policy_hash').notNull(),
  policyVersion: integer('policy_version').notNull().default(1),
  /** The app owner's own affiliate ids (AffiliateConfig), validated at write time. Null = none. */
  affiliateConfig: jsonb('affiliate_config').$type<AffiliateConfig>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const advertisers = pgTable('advertisers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Matched against policy.competitor_exclusions; unique so a domain maps to one advertiser. */
  domain: text('domain').notNull().unique(),
  createdAt: createdAt(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    /**
     * The public lookup handle. A presented key looks like ak_<prefix>_<secret>: the prefix is
     * stored in clear to find the row, the secret is compared against hashed_key (argon2).
     */
    keyPrefix: text('key_prefix').notNull().unique(),
    hashedKey: text('hashed_key').notNull(),
    role: text('role', { enum: API_KEY_ROLES }).notNull(),
    /** Set for advertiser_read keys: the advertiser whose records the key may read. */
    advertiserId: text('advertiser_id').references(() => advertisers.id),
    createdAt: createdAt(),
    revokedAt: timestamptz('revoked_at'),
    lastUsedAt: timestamptz('last_used_at'),
  },
  (table) => [
    index('api_keys_app_id_idx').on(table.appId),
    check('api_keys_role_check', sql`${table.role} in (${sqlList(API_KEY_ROLES)})`),
    check(
      'api_keys_advertiser_check',
      sql`(${table.role} = 'advertiser_read') = (${table.advertiserId} is not null)`,
    ),
  ],
);
