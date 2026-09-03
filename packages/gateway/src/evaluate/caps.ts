import { type CapRow, capStateFrom, nextCapRow } from '@adgate/core';
import type { CapState } from '@adgate/schemas';
import { and, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../db/client.js';
import { capState, userDayCaps } from '../db/tables/caps.js';

/**
 * Frequency-cap counters (docs/policy.md frequency_caps): the bridge between the cap_state and
 * user_day_caps tables and the pure CapState the policy engine reads. The semantics (a turn per
 * call, session_count and last_turn_index on a serve, keep-first user hash) live in
 * @adgate/core policy/caps.ts; this module only reads rows and stores what nextCapRow computes.
 * The pipeline reads once before the policy runs; the audit store reads AGAIN under the app
 * lock and writes in the same transaction, so a rolled-back record never counts a turn and two
 * concurrent turns of one conversation can never both serve under per_session 1.
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

/** The conversation's cap_state row as core's CapRow, or null before its first turn. */
export const readCapRow = async (
  db: DbOrTx,
  key: Pick<CapKey, 'appId' | 'conversationHash'>,
): Promise<CapRow | null> => {
  const [row] = await db
    .select({
      sessionCount: capState.sessionCount,
      turnCount: capState.turnCount,
      lastTurnIndex: capState.lastTurnIndex,
      userHash: capState.userHash,
    })
    .from(capState)
    .where(and(eq(capState.appId, key.appId), eq(capState.conversationHash, key.conversationHash)))
    .limit(1);
  return row === undefined
    ? null
    : {
        session_count: row.sessionCount,
        turn_count: row.turnCount,
        last_turn_index: row.lastTurnIndex,
        user_hash: row.userHash,
      };
};

/** Ads served to the user on the UTC day across conversations; 0 without a user hash. */
export const readDayCount = async (db: DbOrTx, key: CapKey): Promise<number> => {
  if (key.userHash === null) {
    return 0;
  }
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
  return day?.count ?? 0;
};

export interface CapSnapshot {
  row: CapRow | null;
  state: CapState;
}

export const readCapSnapshot = async (db: DbOrTx, key: CapKey): Promise<CapSnapshot> => {
  const row = await readCapRow(db, key);
  return { row, state: capStateFrom(row, await readDayCount(db, key)) };
};

export const createCapReader = (db: DbOrTx): CapReader => ({
  read: async (key) => (await readCapSnapshot(db, key)).state,
});

export interface CapUpdate extends CapKey {
  /** The row read in this transaction under the app lock (readCapSnapshot); null when new. */
  row: CapRow | null;
  /** true when the decision was serve: bumps session_count, last_turn_index and the day count. */
  served: boolean;
  now: Date;
}

/**
 * Stores nextCapRow(row, turn) for the conversation and counts the served ad for the user's
 * day. The cap_state values are written as computed, not as SQL increments: every writer runs
 * inside the audit transaction after lockApp, so the row read there cannot change underneath.
 */
export const applyCapUpdates = async (tx: DbOrTx, update: CapUpdate): Promise<void> => {
  const next = nextCapRow(update.row, { served: update.served, user_hash: update.userHash });
  const values = {
    userHash: next.user_hash,
    sessionCount: next.session_count,
    turnCount: next.turn_count,
    lastTurnIndex: next.last_turn_index,
    updatedAt: update.now,
  };
  await tx
    .insert(capState)
    .values({ appId: update.appId, conversationHash: update.conversationHash, ...values })
    .onConflictDoUpdate({ target: [capState.appId, capState.conversationHash], set: values });
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
