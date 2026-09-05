import Link from 'next/link';

import { CopyButton } from '@/components/copy-button';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import {
  formatAmount,
  formatCount,
  formatPercent,
  formatPolicyVersion,
  formatTimestamp,
  truncateHash,
} from '@/lib/format';
import { computeGlobalMetrics, type GlobalMetrics } from '@/lib/metrics';
import { defaultMetricsWindow, globalMetricRows, METRICS_WINDOW_DAYS } from '@/lib/metrics-queries';
import { AUDIT_WINDOW_DAYS, listAppsWithCounts } from '@/lib/queries';

/**
 * The app list: one row per tenant registered against this gateway, with the policy it is
 * running, the size of its private creative catalog and how many turns it evaluated in the
 * last 30 days. Read only; "New app" is the one link that leads to a write.
 *
 * The header is the whole gateway in five numbers (docs/BUILD_GUIDE.md Phase 8): how many apps
 * are integrated, how many turns they processed, how many of those the policy let reach demand,
 * what those eligible turns earned per thousand, and how many advertisers have taken a
 * verification report. Computed by the pure lib/metrics.ts from grouped counts.
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
  const [apps, rows] = await Promise.all([
    listAppsWithCounts(),
    globalMetricRows(defaultMetricsWindow()),
  ]);

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
          <p className="mt-1 text-sm text-stone-500">
            {apps.length} {apps.length === 1 ? 'app' : 'apps'} registered
          </p>
        </div>
        <Link
          href="/apps/new"
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          New app
        </Link>
      </div>

      <div className="mb-8">
        <MetricGrid metrics={headlineMetrics(computeGlobalMetrics(rows))} />
      </div>

      {apps.length === 0 ? (
        <div className="card text-sm text-stone-600">
          <p className="font-medium text-stone-900">No apps yet.</p>
          <p className="mt-1">
            Register one with <Link href="/apps/new">New app</Link>, or from the command line with{' '}
            <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">
              pnpm --filter @adgate/gateway create-app --name &quot;My chat app&quot;
            </code>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full border-collapse">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className="table-head">Name</th>
                <th className="table-head">App id</th>
                <th className="table-head">Policy</th>
                <th className="table-head">Created</th>
                <th className="table-head">Creatives</th>
                <th className="table-head">Turns ({AUDIT_WINDOW_DAYS}d)</th>
                <th className="table-head">Last turn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {apps.map((app) => (
                <tr key={app.id} data-testid="app-row">
                  <td className="table-cell font-medium text-stone-900">
                    <Link href={`/apps/${app.id}`} className="underline-offset-2 hover:underline">
                      {app.name}
                    </Link>
                  </td>
                  <td className="table-cell font-mono text-xs">{app.id}</td>
                  <td className="table-cell">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs">
                        {formatPolicyVersion(app.policyVersion)}
                      </span>
                      <span
                        data-testid="app-policy-hash"
                        title={app.policyHash}
                        className="font-mono text-xs text-stone-500"
                      >
                        {truncateHash(app.policyHash)}
                      </span>
                      <CopyButton value={app.policyHash} label="Copy" />
                    </span>
                  </td>
                  <td className="table-cell font-mono text-xs">{formatTimestamp(app.createdAt)}</td>
                  <td className="table-cell tabular-nums">{app.creativeCount}</td>
                  <td className="table-cell tabular-nums">{app.auditCount30d}</td>
                  <td className="table-cell font-mono text-xs">
                    {formatTimestamp(app.lastTurnAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default AppsPage;
