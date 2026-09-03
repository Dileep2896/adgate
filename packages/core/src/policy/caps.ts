import type { CapState } from '@adgate/schemas';

/**
 * Frequency-cap counter semantics (docs/policy.md frequency_caps), pure so the gateway's SQL
 * stores only what this module computes. One CapRow per (app, conversation): every evaluate
 * call is a turn; a served ad bumps session_count and records the turn index it was served
 * at, so turns_since_last = turn_count - last_turn_index on the next call and null until the
 * first ad. The user hash is the first one the conversation carried. The per-user day count
 * (per_user_per_day, across conversations) lives in its own table and is passed in.
 */
export interface CapRow {
  /** Ads served in this conversation (CapState.session_count). */
  session_count: number;
  /** Evaluate calls seen in this conversation, ads or not. */
  turn_count: number;
  /** turn_count at the last served ad, null until the first. */
  last_turn_index: number | null;
  /** The normalised user hash first seen on this conversation, if any. */
  user_hash: string | null;
}

export const EMPTY_CAP_ROW: Readonly<CapRow> = Object.freeze({
  session_count: 0,
  turn_count: 0,
  last_turn_index: null,
  user_hash: null,
});

/** The policy engine's CapState from a conversation's row (none = new) and the user's day count. */
export const capStateFrom = (row: CapRow | null | undefined, dayCount: number): CapState => {
  const current = row ?? EMPTY_CAP_ROW;
  return {
    session_count: current.session_count,
    day_count: dayCount,
    turns_since_last:
      current.last_turn_index === null ? null : current.turn_count - current.last_turn_index,
  };
};

export interface CapTurn {
  /** true when the decision was serve. */
  served: boolean;
  /** userHash() of the request, or null; kept only when the row has none yet. */
  user_hash: string | null;
}

/** The row after one more turn. Never mutates its input. */
export const nextCapRow = (row: CapRow | null | undefined, turn: CapTurn): CapRow => {
  const current = row ?? EMPTY_CAP_ROW;
  const turn_count = current.turn_count + 1;
  return {
    session_count: current.session_count + (turn.served ? 1 : 0),
    turn_count,
    last_turn_index: turn.served ? turn_count : current.last_turn_index,
    user_hash: current.user_hash ?? turn.user_hash,
  };
};
