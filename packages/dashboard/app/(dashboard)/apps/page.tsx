import Link from 'next/link';

import { CopyButton } from '@/components/copy-button';
import { EmptyState } from '@/components/empty-state';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import { PageHeader } from '@/components/page-header';
import {
  formatAmount,
  formatCount,
  formatPercent,
  formatPolicyVersion,
  formatRelativeTime,
  formatTimestamp,
  truncateHash,
} from '@/lib/format';
import { requireSession } from '@/lib/auth';
import { computeGlobalMetrics, type GlobalMetrics } from '@/lib/metrics';
import { defaultMetricsWindow, globalMetricRows, METRICS_WINDOW_DAYS } from '@/lib/metrics-queries';
import { listAppsWithCounts } from '@/lib/queries';

/**
 * The app list: one row per tenant registered against this gateway, with the policy it is
 * running, the size of its private creative catalog and how many turns it evaluated in the
 * last 30 days. Read only; "New app" is the one link that leads to a write.
 *
 * The header is the whole gateway in five numbers (docs/BUILD_GUIDE.md Phase 8): how many apps
 * are integrated, how many turns they processed, how many of those the policy let reach demand,
 * what those eligible turns earned per thousand, and how many advertisers have taken a
 * verification report. Computed by the pure lib/metrics.ts from grouped counts.
 *
 * COLUMN PRIORITY. Name, app id and Last turn are what an operator scans for - which app,
 * which id do I paste into a snippet, and is it alive - so those three never leave. Created
 * and the policy hash drop below 80rem, where the row would otherwise start scrolling for
 * everyone; the table's own scroller carries them the rest of the way and the page body
 * never moves sideways.
 */

export const dynamic = 'force-dynamic';

/** The five numbers, in the order the story tells them. */
const headlineMetrics = (metrics: GlobalMetrics): Metric[] => [
  {
    label: 'Apps integrated',
    value: formatCount(metrics.appsIntegrated),
    hint: 'have written an audit record',
    testId: 'global-apps',
  },
  {
    label: `Turns (${METRICS_WINDOW_DAYS}d)`,
    value: formatCount(metrics.turnsEvaluated),
    hint: `${formatCount(metrics.serves)} served`,
    testId: 'global-turns',
  },
  {
    label: 'Ad eligible',
    value: formatPercent(metrics.eligibleRate),
    hint: `${formatCount(metrics.adEligible)} turns reached demand`,
    testId: 'global-eligible-rate',
  },
  {
    label: 'RPM',
    value: formatAmount(metrics.rpm),
    hint: 'per 1000 eligible turns',
    testId: 'global-rpm',
  },
  {
    label: 'Advertisers with a report',
    value: formatCount(metrics.advertisersWithReport),
    hint: 'verification reports generated',
    testId: 'global-reports',
  },
];

const AppsPage = async () => {
  // EVERY NUMBER ON THIS PAGE IS SCOPED TO THE SIGNED-IN ACCOUNT. An admin's scope is "every
  // app", so the operator still sees the gateway-wide header this dashboard has always shown; a
  // member sees the same five numbers over their own apps, which is the only honest thing to put
  // in front of them - a gateway-wide RPM is somebody else's business.
  const session = await requireSession('/apps');
  // ONE window for the whole page: the header's "Turns (30d)" and the per-app column below it
  // are the same 30 whole UTC days, so the column really does add up to the headline.
  const period = defaultMetricsWindow();
  const [apps, rows] = await Promise.all([
    listAppsWithCounts(session.scope, period),
    globalMetricRows(session.scope, period),
  ]);
  const now = new Date();
  const admin = session.role === 'admin';

  return (
    <section>
      <PageHeader
        title="Apps"
        lede={
          admin
            ? `${String(apps.length)} ${apps.length === 1 ? 'app' : 'apps'} registered against this gateway.`
            : `${String(apps.length)} ${apps.length === 1 ? 'app' : 'apps'} on your account. Every number below counts only your apps.`
        }
        actions={
          <Link href="/apps/new" className="ag-btn ag-btn-primary">
            New app
          </Link>
        }
      />

      <MetricGrid metrics={headlineMetrics(computeGlobalMetrics(rows))} />

      <div className="mt-6">
        {apps.length === 0 ? (
          <EmptyState
            title="No apps yet."
            testId="apps-empty"
            actions={
              <Link href="/apps/new" className="ag-btn ag-btn-primary">
                Register an app
              </Link>
            }
          >
            An app is one tenant of this gateway: it owns a policy, a private creative catalog and
            its own hash chain of audit records. Registering one issues its first API key and gives
            you the app id the SDK sends on every evaluate call.
            {admin ? (
              <>
                {' '}
                You can also do it from the command line:{' '}
                <span className="ag-code">
                  pnpm --filter @adgate/gateway create-app --name &quot;My chat app&quot;
                </span>
                . Apps created that way have no owner and are visible here only to an operator.
              </>
            ) : null}
          </EmptyState>
        ) : (
          <div className="ag-table-scroll">
            <table className="ag-table">
              <thead>
                <tr>
                  <th scope="col" className="table-head">
                    Name
                  </th>
                  <th scope="col" className="table-head">
                    App id
                  </th>
                  <th scope="col" className="table-head max-2xl:hidden">
                    Policy
                  </th>
                  <th scope="col" className="table-head max-lg:hidden">
                    Created
                  </th>
                  <th scope="col" className="table-head">
                    Creatives
                  </th>
                  <th scope="col" className="table-head">
                    Turns ({METRICS_WINDOW_DAYS}d)
                  </th>
                  <th scope="col" className="table-head">
                    Last turn
                  </th>
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <tr key={app.id} data-testid="app-row">
                    <td className="table-cell table-cell-strong">
                      <Link href={`/apps/${app.id}`} className="ag-link-quiet">
                        <span className="ag-truncate" title={app.name}>
                          {app.name}
                        </span>
                      </Link>
                    </td>
                    <td className="table-cell ag-mono-2xs table-cell-nowrap">{app.id}</td>
                    <td className="table-cell max-2xl:hidden">
                      <span className="flex items-center gap-2">
                        <span className="ag-mono-2xs">
                          {formatPolicyVersion(app.policyVersion)}
                        </span>
                        <span
                          data-testid="app-policy-hash"
                          title={app.policyHash}
                          className="ag-mono-2xs"
                        >
                          {truncateHash(app.policyHash)}
                        </span>
                        <CopyButton value={app.policyHash} label="Copy" />
                      </span>
                    </td>
                    <td className="table-cell ag-mono-2xs table-cell-nowrap max-lg:hidden">
                      {formatTimestamp(app.createdAt)}
                    </td>
                    <td className="table-cell">{app.creativeCount}</td>
                    <td className="table-cell">{app.auditCount30d}</td>
                    <td className="table-cell table-cell-nowrap">
                      {app.lastTurnAt === null ? (
                        <span className="ag-badge">No turns yet</span>
                      ) : (
                        <span title={formatTimestamp(app.lastTurnAt)}>
                          {formatRelativeTime(app.lastTurnAt, now)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};

export default AppsPage;
