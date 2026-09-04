import { listAppsWithCounts } from '@/lib/queries';

/**
 * The app list: one row per tenant registered against this gateway, with the size of its
 * private creative catalog and how many turns it has been through. Read only.
 *
 * S31 adds creating an app, editing its policy YAML and the per-app overview charts.
 */

export const dynamic = 'force-dynamic';

const formatDate = (value: Date | null): string =>
  value === null ? '-' : value.toISOString().replace('T', ' ').slice(0, 19) + 'Z';

const AppsPage = async () => {
  const apps = await listAppsWithCounts();

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
        <p className="text-sm text-stone-500">
          {apps.length} {apps.length === 1 ? 'app' : 'apps'} registered
        </p>
      </div>

      {apps.length === 0 ? (
        <div className="card text-sm text-stone-600">
          <p className="font-medium text-stone-900">No apps yet.</p>
          <p className="mt-1">
            Register one with{' '}
            <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">
              pnpm --filter @adgate/gateway create-app &quot;My chat app&quot;
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
                <th className="table-head">Creatives</th>
                <th className="table-head">Turns</th>
                <th className="table-head">Last turn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {apps.map((app) => (
                <tr key={app.id} data-testid="app-row">
                  <td className="table-cell font-medium text-stone-900">{app.name}</td>
                  <td className="table-cell font-mono text-xs">{app.id}</td>
                  <td className="table-cell font-mono text-xs">
                    v{app.policyVersion} - {app.policyHash.slice(0, 19)}...
                  </td>
                  <td className="table-cell tabular-nums">{app.creativeCount}</td>
                  <td className="table-cell tabular-nums">{app.turnCount}</td>
                  <td className="table-cell font-mono text-xs">{formatDate(app.lastTurnAt)}</td>
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
