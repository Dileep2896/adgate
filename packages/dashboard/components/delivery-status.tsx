import type { CreativeDelivery } from '@/lib/deliverability';
import { blockedForApps } from '@/lib/delivery-copy';

/**
 * The Status cell of /creatives, which used to be a green `active` badge and nothing else.
 *
 * `active` in the catalog and "can actually serve" are two different facts, and a creative can be
 * active, matching, priced and still never appear: its network is on no enabled demand entry, or
 * the app has no affiliate account to credit. This cell tells them apart, because the green badge
 * was the thing sending developers to the audit records' demand trace to find out why fill was 0.
 *
 * DELIVERABILITY IS PER (CREATIVE, APP). A creative in the shared catalog is judged against every
 * app the session can see, so the worst case is what shows here with the count beside it; the
 * breakdown is on the creative's own page. Server rendered from plain data (lib/deliverability.ts
 * runs the diagnostic), so nothing from @adgate/core reaches the browser.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL (design.md): every state below is a word - paused, active,
 * partly blocked, cannot serve - and the reason code beside it is the same string `check-catalog`
 * prints, with the sentence naming the fix on the title attribute.
 */

export interface DeliveryStatusProps {
  active: boolean;
  delivery: CreativeDelivery;
  testId?: string;
}

/** `affiliate_not_configured, blocked for 2 of 3 apps` - one line, truncated in CSS. */
const summaryLine = (delivery: CreativeDelivery): string => {
  const reason = delivery.worst?.reason ?? 'policy_unreadable';
  const count = blockedForApps(delivery.blocked, delivery.judged);
  return count === null ? reason : `${reason}, ${count}`;
};

export const DeliveryStatus = ({ active, delivery, testId }: DeliveryStatusProps) => {
  if (!active) {
    // `inactive` IS the deliverability reason here, and "paused" is the word the toggle beside it
    // uses. Reporting both would be the same fact twice in two vocabularies.
    return (
      <span data-testid={testId} data-delivery="paused" className="ag-badge">
        paused
      </span>
    );
  }

  if (delivery.judged === 0) {
    return (
      <>
        <span data-testid={testId} data-delivery="unjudged" className="ag-badge">
          active
        </span>
        <span
          className="ag-mono-2xs ag-truncate ag-truncate-sm"
          title="Shared inventory, and you have no app yet for it to serve in. Register an app and it will be judged against that app's policy."
        >
          no app to serve it
        </span>
      </>
    );
  }

  if (delivery.worst === null) {
    return (
      <span data-testid={testId} data-delivery="serving" className="ag-badge ag-badge-ok">
        active
      </span>
    );
  }

  const everywhere = delivery.blocked === delivery.judged;
  const detail = delivery.worst.detail ?? '';
  return (
    <>
      <span
        data-testid={testId}
        data-delivery={everywhere ? 'blocked' : 'partly-blocked'}
        className={everywhere ? 'ag-badge ag-badge-danger' : 'ag-badge ag-badge-warn'}
      >
        {everywhere ? 'cannot serve' : 'partly blocked'}
      </span>
      <span
        data-testid="creative-block-reason"
        className="ag-mono-2xs ag-truncate ag-truncate-sm"
        title={detail}
      >
        {summaryLine(delivery)}
      </span>
    </>
  );
};
