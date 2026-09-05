import { getTableName } from 'drizzle-orm';

import { advertisers, apiKeys, apps } from './tables/apps.js';
import { auditRecords, events, rawText } from './tables/audit.js';
import { capState, classifyCache, userDayCaps } from './tables/caps.js';
import { creatives } from './tables/catalog.js';
import { rateLimits } from './tables/rate-limits.js';
import { reports } from './tables/reports.js';
import { retentionState } from './tables/retention.js';

/**
 * The Drizzle schema: every table in one place for `drizzle(sql, { schema })` and for tests
 * that need the table list. drizzle-kit reads the same tables through drizzle.config.ts.
 */
export * from './tables/apps.js';
export * from './tables/audit.js';
export * from './tables/caps.js';
export * from './tables/catalog.js';
export * from './tables/rate-limits.js';
export * from './tables/reports.js';
export * from './tables/retention.js';

export const ALL_TABLES = [
  apps,
  advertisers,
  apiKeys,
  creatives,
  auditRecords,
  events,
  rawText,
  capState,
  userDayCaps,
  classifyCache,
  rateLimits,
  reports,
  retentionState,
] as const;

/** The SQL names of every table, in ALL_TABLES order. */
export const TABLE_NAMES: readonly string[] = ALL_TABLES.map((table) => getTableName(table));
