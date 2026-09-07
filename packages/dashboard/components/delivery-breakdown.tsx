import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import type { CreativeDelivery } from '@/lib/deliverability';

/**
 * Can this creative serve, for each app that could serve it, and if not what has to change.
 *
 * THIS IS THE ANSWER TO "WHY IS MY FILL RATE ZERO", one row per app. The verdict is per
 * (creative, app) - the same creative is deliverable under one app's policy and blocked under
 * another's, because the policy demand list and the affiliate config are per app - so a single
 * badge could never be honest about a creative in the shared catalog.
 *
 * The reason code and the sentence beside it are produced by @adgate/core and are the SAME
 * strings `pnpm --filter @adgate/gateway check-catalog` prints, deliberately: an operator who
 * reads one and then the other must not have to translate.
 *
 * Server rendered from plain data. Four columns; the fix sentence is the one that matters most,
 * so it never leaves, and the reason code drops at 48rem where the sentence already contains it.
 */

export interface DeliveryBreakdownProps {
  delivery: CreativeDelivery;
  /** False for a paused creative, so the copy can say that is the first thing to change. */
  active: boolean;
  /** True when the creative is in the shared catalog and every app in scope judged it. */
  shared: boolean;
}

export const DeliveryBreakdown = ({ delivery, active, shared }: DeliveryBreakdownProps) => (
  <div data-testid="delivery-breakdown">
    <div className="ag-section-head">
      <h2 className="ag-section-title">Delivery</h2>
      <p className="ag-section-hint">
        {delivery.judged === 0
          ? 'No app can serve this creative yet.'
          : `Can serve for ${String(delivery.judged - delivery.blocked)} of ${String(delivery.judged)} ${delivery.judged === 1 ? 'app' : 'apps'}.`}
      </p>
    </div>

    {delivery.judged === 0 ? (
      <EmptyState
        testId="delivery-empty"
        title="Nothing has judged this creative yet."
        actions={
          <Link href="/apps/new" className="ag-btn ag-btn-primary">
            Register an app
          </Link>
        }
      >
        Whether a creative can serve is decided per app, against that app&apos;s policy and its
        affiliate accounts. This one is in the shared catalog and you have no app for it to serve
        in, so there is nothing to judge it against yet.
      </EmptyState>
    ) : (
      <>
        <div className="ag-table-scroll">
          <table className="ag-table">
            <thead>
              <tr>
                <th scope="col" className="table-head">
                  App
                </th>
                <th scope="col" className="table-head">
                  Can serve
                </th>
                <th scope="col" className="table-head max-md:hidden">
                  Reason
                </th>
                <th scope="col" className="table-head">
                  What to change
                </th>
              </tr>
            </thead>
            <tbody>
              {delivery.perApp.map((entry) => (
                <tr key={entry.appId} data-testid="delivery-row">
                  <td className="table-cell table-cell-strong">
                    <Link href={`/apps/${entry.appId}`} className="ag-link-quiet">
                      <span className="ag-truncate" title={entry.appName}>
                        {entry.appName}
                      </span>
                    </Link>
                    <span className="ag-mono-2xs ag-truncate">{entry.appId}</span>
                  </td>
                  <td className="table-cell table-cell-nowrap">
                    <span
                      data-testid="delivery-verdict"
                      className={
                        entry.deliverable ? 'ag-badge ag-badge-ok' : 'ag-badge ag-badge-danger'
                      }
                    >
                      {entry.deliverable ? 'yes' : 'no'}
                    </span>
                  </td>
                  <td
                    className="table-cell ag-mono-2xs max-md:hidden"
                    data-testid="delivery-reason"
                  >
                    {entry.reason ?? (entry.deliverable ? '-' : 'policy_unreadable')}
                  </td>
                  <td className="table-cell">
                    {entry.detail === null ? (
                      <span className="ag-hint">Nothing. It is eligible for the next turn.</span>
                    ) : (
                      <span data-testid="delivery-fix">{entry.detail}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ag-hint">
          {shared
            ? 'This creative is in the shared catalog, so it is judged against every app you can see. The same creative can serve for one app and be blocked for another: the policy demand list and the affiliate accounts are per app.'
            : 'Judged against this app’s stored policy and its affiliate accounts.'}{' '}
          {active
            ? 'The same check runs in pnpm --filter @adgate/gateway check-catalog, in these words.'
            : 'It is paused, which blocks it everywhere: reactivate it above before changing anything else.'}
        </p>
      </>
    )}
  </div>
);
