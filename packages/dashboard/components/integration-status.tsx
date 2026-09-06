import { formatCount, formatRelativeTime, formatTimestamp } from '@/lib/format';

/**
 * Has this gateway ever seen a turn from this app, and when was the last one?
 *
 * It is the one line that tells an operator whether the snippet above it is actually
 * running. Everything before it - the key, the app id, the code - is something they set up;
 * this is the first evidence anything arrived, which is why it sits inside the Integration
 * section rather than beside the charts.
 *
 * Derived from the audit chain (lib/metrics-queries.ts appLastTurn), not from a new table
 * and not from a heartbeat: an audit record IS the record that a turn was evaluated, so the
 * newest one is by definition the last turn. The relative wording is always paired with the
 * absolute UTC timestamp - "4 minutes ago" is what you read, the timestamp is what you paste
 * into a ticket.
 *
 * Presentational and server rendered; `now` is injected so the copy is testable.
 */

export interface IntegrationStatusProps {
  /** The app's most recent audit record, or null when it has never evaluated a turn. */
  lastTurnAt: Date | null;
  /** Turns inside the overview window, so a once-busy app that went quiet still reads right. */
  turnsInWindow: number;
  windowDays: number;
  now?: Date;
}

export const IntegrationStatus = ({
  lastTurnAt,
  turnsInWindow,
  windowDays,
  now = new Date(),
}: IntegrationStatusProps) => {
  if (lastTurnAt === null) {
    return (
      <p className="ag-note" data-testid="integration-status" data-live="false">
        <span className="ag-badge">Waiting</span>{' '}
        <strong className="ag-note-strong">No turns yet</strong> — waiting for your first evaluate
        call. As soon as your server calls <span className="ag-code">POST /v1/evaluate</span> with
        this app id, the turn is signed into the chain and shows up here and under Audit. A first
        integration that suppresses nearly every turn is working correctly.
      </p>
    );
  }
  return (
    <p className="ag-note ag-note-ok" data-testid="integration-status" data-live="true">
      <span className="ag-badge ag-badge-ok">Live</span>{' '}
      <strong className="ag-note-strong">Last turn {formatRelativeTime(lastTurnAt, now)}</strong> —{' '}
      <span className="ag-mono-2xs">{formatTimestamp(lastTurnAt)}</span>, and{' '}
      {formatCount(turnsInWindow)} {turnsInWindow === 1 ? 'turn' : 'turns'} in the last{' '}
      {String(windowDays)} days.
    </p>
  );
};
