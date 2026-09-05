import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiKeysTable } from '@/components/api-keys-table';
import { AppOverview } from '@/components/app-overview';
import { CopyButton } from '@/components/copy-button';
import { PolicyEditor } from '@/components/policy-editor';
import { formatTimestamp } from '@/lib/format';
import { computeMetrics, decisionsPerDay, suppressBreakdown } from '@/lib/metrics';
import {
  appDecisionCounts,
  appEventCounts,
  defaultMetricsWindow,
  METRICS_WINDOW_DAYS,
} from '@/lib/metrics-queries';
import { getApp, listApiKeys } from '@/lib/queries';

/**
 * One app: how it is doing, its policy in an editor, and its API keys. The two writes this page
 * can start (save the policy, revoke a key) are server actions in ../actions.ts and use the
 * dashboard's only read-write handle; everything rendered here is read through lib/queries.ts
 * and lib/metrics-queries.ts, and every number is computed by the pure lib/metrics.ts.
 */

export const dynamic = 'force-dynamic';

const AppDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const app = await getApp(id);
  if (app === null) {
    notFound();
  }
  const metricWindow = defaultMetricsWindow();
  const [keys, decisions, eventCounts] = await Promise.all([
    listApiKeys(app.id),
    appDecisionCounts(app.id, metricWindow),
    appEventCounts(app.id, metricWindow),
  ]);

  return (
    <section className="space-y-8">
      <div>
        <Link href="/apps" className="text-sm text-stone-500 underline-offset-2 hover:underline">
          &larr; Apps
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{app.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
          <span data-testid="app-id" className="font-mono text-xs">
            {app.id}
          </span>
          <CopyButton value={app.id} label="Copy id" />
          <span className="text-xs">created {formatTimestamp(app.createdAt)}</span>
          <span className="text-xs">updated {formatTimestamp(app.updatedAt)}</span>
        </p>
      </div>

      <AppOverview
        metrics={computeMetrics(decisions, eventCounts)}
        daily={decisionsPerDay(decisions, metricWindow)}
        breakdown={suppressBreakdown(decisions)}
        days={METRICS_WINDOW_DAYS}
      />

      <PolicyEditor
        appId={app.id}
        policyYaml={app.policyYaml}
        policyHash={app.policyHash}
        policyVersion={app.policyVersion}
      />

      <div>
        <h2 className="mb-3 text-sm font-semibold text-stone-900">API keys</h2>
        <ApiKeysTable appId={app.id} keys={keys} />
        <p className="mt-2 text-xs text-stone-500">
          Key values are never stored: adgate keeps an argon2id hash, so a key is readable only on
          the screen that issues it. Revoking takes effect on the gateway&apos;s next request.
        </p>
      </div>
    </section>
  );
};

export default AppDetailPage;
