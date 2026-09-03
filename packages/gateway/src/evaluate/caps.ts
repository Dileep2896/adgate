import type { CapState } from '@adgate/schemas';
import { and, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../db/client.js';
import { capState, userDayCaps } from '../db/tables/caps.js';

/**
 * Frequency-cap counters (docs/policy.md frequency_caps): the bridge between the cap_state and
 * user_day_caps tables and the pure CapState the policy engine reads. Read before the policy
 * runs, written inside the audit transaction after the decision. Every evaluate call counts as
 * a turn (turn_count); a serve also bumps session_count, records the turn index the ad was
 * served at (so turns_since_last = turn_count - last_turn_index on the next call) and, when
 * the request carried a user_hash, the user's count for the UTC day.
 */

export interface CapKey {
  appId: string;
  /** conversationIdHash(app.salt, conversation_id). */
  conversationHash: string;
  /** userHash() of the request's user_hash; null disables the per-day cap. */
  userHash: string | null;
  /** The UTC calendar day, YYYY-MM-DD (utcDay). */
  day: string;
}

export interface CapReader {
  read(key: CapKey): Promise<CapState>;
}

/** The UTC calendar day of a millisecond timestamp, as user_day_caps.day stores it. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface CapRow {
  sessionCount: number;
  turnCount: number;
  lastTurnIndex: number | null;
}

/** CapState from the cap_state row (absent = a new conversation) and the user's day count. */
export const capStateFrom = (row: CapRow | undefined, dayCount: number): CapState => ({
  session_count: row?.sessionCount ?? 0,
  day_count: dayCount,
  turns_since_last:
    row === undefined || row.lastTurnIndex === null ? null : row.turnCount - row.lastTurnIndex,
});

export const createCapReader = (db: DbOrTx): CapReader => ({
  async read(key) {
    const [row] = await db
      .select({
        sessionCount: capState.sessionCount,
        turnCount: capState.turnCount,
        lastTurnIndex: capState.lastTurnIndex,
      })
      .from(capState)
      .where(
        and(eq(capState.appId, key.appId), eq(capState.conversationHash, key.conversationHash)),
      )
      .limit(1);
    let dayCount = 0;
    if (key.userHash !== null) {
      const [day] = await db
        .select({ count: userDayCaps.count })
        .from(userDayCaps)
        .where(
          and(
            eq(userDayCaps.appId, key.appId),
            eq(userDayCaps.userHash, key.userHash),
            eq(userDayCaps.day, key.day),
          ),
        )
        .limit(1);
      dayCount = day?.count ?? 0;
    }
    return capStateFrom(row, dayCount);
  },
});

export interface CapUpdate extends CapKey {
  /** true when the decision was serve: bumps session_count, last_turn_index and the day count. */
  served: boolean;
  now: Date;
}

/**
 * Counts the turn (and the served ad) with one upsert per table. Meant to run inside the
 * audit transaction so a rolled-back record never leaves a counted turn behind.
 */
export const applyCapUpdates = async (tx: DbOrTx, update: CapUpdate): Promise<void> => {
  const served = sql.raw(update.served ? '1' : '0');
  await tx
    .insert(capState)
    .values({
      appId: update.appId,
      conversationHash: update.conversationHash,
      userHash: update.userHash,
      sessionCount: update.served ? 1 : 0,
      turnCount: 1,
      lastTurnIndex: update.served ? 1 : null,
      updatedAt: update.now,
    })
    .onConflictDoUpdate({
      target: [capState.appId, capState.conversationHash],
      set: {
        turnCount: sql`${capState.turnCount} + 1`,
        sessionCount: sql`${capState.sessionCount} + ${served}`,
        ...(update.served ? { lastTurnIndex: sql`${capState.turnCount} + 1` } : {}),
        // Keep the first user_hash seen; adopt one if the conversation started without it.
        userHash: sql`coalesce(${capState.userHash}, ${sql.raw('excluded.user_hash')})`,
        updatedAt: update.now,
      },
    });
  if (update.served && update.userHash !== null) {
    await tx
      .insert(userDayCaps)
      .values({
        appId: update.appId,
        userHash: update.userHash,
        day: update.day,
        count: 1,
        updatedAt: update.now,
      })
      .onConflictDoUpdate({
        target: [userDayCaps.appId, userDayCaps.userHash, userDayCaps.day],
        set: { count: sql`${userDayCaps.count} + 1`, updatedAt: update.now },
      });
  }
};
