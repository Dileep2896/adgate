import type { AppReadiness } from '@adgate/gateway/admin';
import Link from 'next/link';

import { fixLocationSentence } from '@/lib/delivery-copy';

/**
 * HOW MUCH OF THIS APP'S CATALOG CAN ACTUALLY SERVE - the number a developer stares at when the
 * fill rate below is zero.
 *
 * It sits with the integration status on purpose. That line answers "did my call arrive"; this
 * one answers the question straight after it, "and can anything come back". They are the two
 * halves of "is this working", and separating them by three sections would mean reading a 0.0%
 * fill rate first and guessing.
 *
 * The counts and the sentence come from the gateway's own appReadiness() over @adgate/core's
 * creativeDeliverability(), the same function `check-catalog` prints, so the words here and the
 * words in the terminal are the same words. What this component adds is one pointer at the
 * section of THIS page that fixes it - the Policy editor or the Affiliate accounts form - which
 * a CLI has no way to say.
 *
 * A ZERO IS NEVER LEFT BARE. When the app has served nothing AND creatives are blocked, the copy
 * says the second thing explains the first, rather than reporting two unrelated numbers.
 */

export interface DemandReadinessProps {
  readiness: AppReadiness;
  /** Ads served in the overview window. Zero plus blocked creatives is the case this exists for. */
  serves: number;
  windowDays: number;
}

/**
 * ONE SENTENCE SHAPE FOR EVERY STATE: "<k> of <n> creatives can serve for this app". A ready app
 * and a blocked one read the same way with different numbers, so the badge and the colour carry
 * the difference and nobody has to notice that the wording changed.
 */
const countOfCreatives = (total: number): string =>
  `${String(total)} ${total === 1 ? 'creative' : 'creatives'}`;

export const DemandReadiness = ({ readiness, serves, windowDays }: DemandReadinessProps) => {
  if (readiness.error !== null) {
    return (
      <p className="ag-note ag-note-danger" data-testid="demand-readiness" data-state="unreadable">
        <span className="ag-badge ag-badge-danger">Unreadable</span>{' '}
        <strong className="ag-note-strong">This app&apos;s stored policy cannot be read</strong> (
        {readiness.error}). Nothing can be judged against it and every turn fails closed to{' '}
        <span className="ag-code">suppress</span>. Fix the document under Policy below.
      </p>
    );
  }

  if (readiness.total === 0) {
    return (
      <p className="ag-note" data-testid="demand-readiness" data-state="empty">
        <span className="ag-badge">Empty</span>{' '}
        <strong className="ag-note-strong">No creatives can serve this app</strong> — its catalog is
        empty, so every eligible turn ends in <span className="ag-code">no_fill</span> however well
        the integration works.{' '}
        <Link href="/creatives/new" className="ag-link">
          Add a creative
        </Link>
        .
      </p>
    );
  }

  const blocked = readiness.total - readiness.deliverable;
  const worst = readiness.blocked[0];
  const quiet = serves === 0;

  if (readiness.deliverable === 0 && worst !== undefined) {
    return (
      <p className="ag-note ag-note-danger" data-testid="demand-readiness" data-state="blocked">
        <span className="ag-badge ag-badge-danger">Blocked</span>{' '}
        <strong className="ag-note-strong">
          0 of {countOfCreatives(readiness.total)} can serve for this app
        </strong>
        {quiet
          ? `, which is why nothing has served in the last ${String(windowDays)} days. `
          : ' — every eligible turn ends in no_fill. '}
        <span data-testid="demand-readiness-fix">{worst.detail}</span>{' '}
        {fixLocationSentence(worst.reason) ?? ''}
      </p>
    );
  }

  if (blocked > 0 && worst !== undefined) {
    return (
      <p className="ag-note ag-note-warn" data-testid="demand-readiness" data-state="partial">
        <span className="ag-badge ag-badge-warn">Partial</span>{' '}
        <strong className="ag-note-strong">
          {String(readiness.deliverable)} of {countOfCreatives(readiness.total)} can serve for this
          app
        </strong>
        {quiet
          ? `, and nothing has served in the last ${String(windowDays)} days. `
          : `. The other ${String(blocked)} never will as things stand: `}
        <span data-testid="demand-readiness-fix">{worst.detail}</span>{' '}
        {fixLocationSentence(worst.reason) ?? ''}
      </p>
    );
  }

  return (
    <p className="ag-note ag-note-ok" data-testid="demand-readiness" data-state="ready">
      <span className="ag-badge ag-badge-ok">Ready</span>{' '}
      <strong className="ag-note-strong">
        {String(readiness.deliverable)} of {countOfCreatives(readiness.total)} can serve for this
        app
      </strong>{' '}
      — nothing structural blocks any of them.
      {quiet
        ? ' Nothing has served yet: a turn still has to be ad-eligible and match a creative’s categories.'
        : ''}
    </p>
  );
};
