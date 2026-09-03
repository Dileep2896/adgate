import type { Classification } from '@adgate/schemas';
import { date, index, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { apps } from './apps.js';
import { timestamptz, updatedAt } from './columns.js';

/**
 * Frequency-cap counters and the classifier cache. The policy engine is pure and receives a
 * CapState { session_count, day_count, turns_since_last }; the gateway derives it from these
 * two tables before evaluating and updates them after deciding.
 */

/** One row per (app, conversation): the per_session and min_turns_between counters. */
export const capState = pgTable(
  'cap_state',
  {
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    /** conversationIdHash(app.salt, conversation_id); the raw id is never stored. */
    conversationHash: text('conversation_hash').notNull(),
    /** The normalised user_hash seen on this conversation, if the app sent one. */
    userHash: text('user_hash'),
    /** Ads served in this conversation (CapState.session_count). */
    sessionCount: integer('session_count').notNull().default(0),
    /** Evaluate calls seen in this conversation, ads or not; the turn index of the next call. */
    turnCount: integer('turn_count').notNull().default(0),
    /** turn_count at the last served ad, null until the first: turns_since_last = turn_count - this. */
    lastTurnIndex: integer('last_turn_index'),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: 'cap_state_pkey', columns: [table.appId, table.conversationHash] }),
  ],
);

/** One row per (app, user, UTC day): per_user_per_day across conversations (CapState.day_count). */
export const userDayCaps = pgTable(
  'user_day_caps',
  {
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    userHash: text('user_hash').notNull(),
    /** The UTC calendar day as YYYY-MM-DD. */
    day: date('day', { mode: 'string' }).notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: 'user_day_caps_pkey', columns: [table.appId, table.userHash, table.day] }),
  ],
);

/** Postgres tier of the classifier cache, keyed by classifyCacheKey() (sha256:<hex>). */
export const classifyCache = pgTable(
  'classify_cache',
  {
    hash: text('hash').primaryKey(),
    classification: jsonb('classification').$type<Classification>().notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [index('classify_cache_expires_at_idx').on(table.expiresAt)],
);
