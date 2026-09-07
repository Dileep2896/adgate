import { notFound } from 'next/navigation';

import { AffiliateForm } from '@/components/affiliate-form';
import { ApiKeysTable } from '@/components/api-keys-table';
import { AppOverview } from '@/components/app-overview';
import { CopyButton } from '@/components/copy-button';
import { IntegrationPanel } from '@/components/integration-panel';
import { IntegrationStatus } from '@/components/integration-status';
import { PageHeader } from '@/components/page-header';
import { PolicyEditor } from '@/components/policy-editor';
import { affiliateFormValues } from '@/lib/affiliate-form';
import { requireSession } from '@/lib/auth';
import { formatTimestamp } from '@/lib/format';
import { computeMetrics, decisionsPerDay, suppressBreakdown } from '@/lib/metrics';
import {
  appDecisionCounts,
  appEventCounts,
  appLastTurn,
  defaultMetricsWindow,
  METRICS_WINDOW_DAYS,
} from '@/lib/metrics-queries';
import { getApp, listApiKeys } from '@/lib/queries';

/**
 * One app: how to wire it up, how it is doing, its policy in an editor, and its API keys. The
 * two writes this page can start (save the policy, revoke a key) are server actions in
 * ../actions.ts and use the dashboard's only read-write handle; everything rendered here is
 * read through lib/queries.ts and lib/metrics-queries.ts, and every number is computed by the
 * pure lib/metrics.ts.
 *
 * INTEGRATION COMES FIRST, ON PURPOSE. The most common visit to this page is the one right
 * after registering the app, when every number below is a zero and the only question is "what
 * do I paste where". The section carries the same snippets as the confirmation screen - the
 * app id already in them, the key named as an environment variable and never shown - plus one
 * line saying whether the gateway has ever seen a turn from this app. That line is derived
 * from the audit chain itself (appLastTurn), because an audit record IS the evidence a turn
 * was evaluated; there is no heartbeat table and there does not need to be one.
 *
 * SCOPE. getApp() carries the session's scope, so an app id belonging to another account answers
 * null and this page renders the ordinary not-found - the same page an id that was never
 * registered gets. The per-app queries below take the id getApp() has already authorised.
 */

export const dynamic = 'force-dynamic';

const AppDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireSession(`/apps/${id}`);
  const app = await getApp(session.scope, id);
  if (app === null) {
    notFound();
  }
  const metricWindow = defaultMetricsWindow();
  const [keys, decisions, eventCounts, lastTurnAt] = await Promise.all([
    listApiKeys(session.scope, app.id),
    appDecisionCounts(app.id, metricWindow),
    appEventCounts(app.id, metricWindow),
    appLastTurn(app.id),
  ]);
  const metrics = computeMetrics(decisions, eventCounts);

  return (
    <section className="space-y-8">
      <PageHeader
        title={app.name}
        back={{ href: '/apps', label: 'All apps' }}
        meta={
          <>
            <span data-testid="app-id" className="ag-mono-2xs">
              {app.id}
            </span>
            <CopyButton value={app.id} label="Copy id" />
            <span>created {formatTimestamp(app.createdAt)}</span>
            <span>updated {formatTimestamp(app.updatedAt)}</span>
          </>
        }
      />

      <IntegrationPanel
        appId={app.id}
        title="Integration"
        lede="Everything this app needs to start evaluating turns. The app id below is already filled in; the key is the one you were shown once when the app was registered, read from an environment variable."
        status={
          <IntegrationStatus
            lastTurnAt={lastTurnAt}
            turnsInWindow={metrics.turnsEvaluated}
            windowDays={METRICS_WINDOW_DAYS}
          />
        }
      />

      <AppOverview
        metrics={metrics}
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
        <div className="ag-section-head">
          <h2 className="ag-section-title">Affiliate accounts</h2>
          <p className="ag-section-hint">Your own program ids. Affiliate demand needs them.</p>
        </div>
        <p className="ag-prose mb-3">
          Affiliate creatives pay <em>you</em>: the link is built from your own PartnerStack,
          impact.com or Amazon Associates identifiers. Until a network has an entry here its adapter
          answers <span className="ag-code">affiliate_not_configured</span> and every eligible turn
          ends in <span className="ag-code">no_fill</span>, however well the app is integrated.
        </p>
        <AffiliateForm appId={app.id} values={affiliateFormValues(app.affiliateConfig)} />
      </div>

      <div>
        <div className="ag-section-head">
          <h2 className="ag-section-title">API keys</h2>
          <p className="ag-section-hint">
            Revoking takes effect on the gateway&apos;s next request.
          </p>
        </div>
        <ApiKeysTable appId={app.id} keys={keys} />
        <p className="ag-hint">
          Key values are never stored: adgate keeps an argon2id hash, so a key is readable only on
          the screen that issues it.
        </p>
      </div>
    </section>
  );
};

export default AppDetailPage;
