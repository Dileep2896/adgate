import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { listAccounts } from '@/lib/account-queries';
import { ADMIN_SCOPE } from '@/lib/app-scope';
import { requireAdmin } from '@/lib/auth';
import { formatCount, formatRelativeTime, formatTimestamp } from '@/lib/format';
import { listAppsWithCounts } from '@/lib/queries';

/**
 * THE OPERATOR VIEW. Who has an account, what they own, and which apps have no owner at all.
 *
 * It is the one admin-only route, and it is what makes `DASHBOARD_ALLOWED_IPS` expressible again
 * now that the console is internet-facing: the allowlist guards `/admin/**`, which is this page
 * plus the break-glass login that mints an operator session (middleware.ts, lib/routes.ts).
 * Signup and the member routes are reachable from anywhere, because a developer console that
 * only one office IP can sign up to is not a developer console.
 *
 * requireAdmin() is the gate, not the nav: a member who types /admin is sent back to /apps
 * rather than to a login form, because they ARE signed in and bouncing them to /login would
 * look like their session had broken.
 *
 * There is nothing to change here. Promoting an account, resetting a password and deleting one
 * are all writes with consequences for somebody else's traffic, and none of them is needed to
 * ship self-serve signup; progress.txt records them under Ideas.
 */

export const dynamic = 'force-dynamic';

const AdminPage = async () => {
  await requireAdmin('/admin');
  const [accounts, apps] = await Promise.all([listAccounts(), listAppsWithCounts(ADMIN_SCOPE)]);
  const now = new Date();
  const byOwner = new Map<string, number>();
  let ownerless = 0;
  for (const app of apps) {
    if (app.ownerUserId === null) {
      ownerless += 1;
    } else {
      byOwner.set(app.ownerUserId, (byOwner.get(app.ownerUserId) ?? 0) + 1);
    }
  }
  const emailById = new Map(accounts.map((account) => [account.id, account.email]));

  return (
    <section className="space-y-8">
      <PageHeader
        title="Operator"
        lede={`${formatCount(accounts.length)} ${accounts.length === 1 ? 'account' : 'accounts'}, ${formatCount(apps.length)} ${apps.length === 1 ? 'app' : 'apps'}, ${formatCount(ownerless)} with no owner. Everything on this page is the whole gateway, not one account.`}
      />

      <div>
        <div className="ag-section-head">
          <h2 className="ag-section-title">Accounts</h2>
          <p className="ag-section-hint">
            Created by self-serve signup. Addresses are not verified: this deployment sends no
            email.
          </p>
        </div>
        {accounts.length === 0 ? (
          <EmptyState title="Nobody has signed up yet." testId="no-accounts">
            An account is created at <span className="ag-code">/signup</span> and immediately owns
            the apps it creates. Until then every app on this gateway is one you made yourself, from
            the console or from{' '}
            <span className="ag-code">pnpm --filter @adgateio/gateway create-app</span>, and only an
            operator can see it.
          </EmptyState>
        ) : (
          <div className="ag-table-scroll">
            <table className="ag-table">
              <thead>
                <tr>
                  <th scope="col" className="table-head">
                    Email
                  </th>
                  <th scope="col" className="table-head">
                    Role
                  </th>
                  <th scope="col" className="table-head">
                    Apps
                  </th>
                  <th scope="col" className="table-head max-lg:hidden">
                    Signed up
                  </th>
                  <th scope="col" className="table-head">
                    Last sign-in
                  </th>
                  <th scope="col" className="table-head max-2xl:hidden">
                    Account id
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} data-testid="account-row">
                    <td className="table-cell table-cell-strong">
                      <span className="ag-truncate" title={account.email}>
                        {account.email}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span
                        className={
                          account.role === 'admin' ? 'ag-badge ag-badge-accent' : 'ag-badge'
                        }
                      >
                        {account.role}
                      </span>
                    </td>
                    <td className="table-cell">{byOwner.get(account.id) ?? 0}</td>
                    <td className="table-cell ag-mono-2xs table-cell-nowrap max-lg:hidden">
                      {formatTimestamp(account.createdAt)}
                    </td>
                    <td className="table-cell table-cell-nowrap">
                      {account.lastLoginAt === null ? (
                        <span className="ag-badge">never</span>
                      ) : (
                        <span title={formatTimestamp(account.lastLoginAt)}>
                          {formatRelativeTime(account.lastLoginAt, now)}
                        </span>
                      )}
                    </td>
                    <td className="table-cell ag-mono-2xs table-cell-nowrap max-2xl:hidden">
                      {account.id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="ag-section-head">
          <h2 className="ag-section-title">Every app</h2>
          <p className="ag-section-hint">
            An app with no owner was created from the CLI or by this operator login, and is
            invisible to every member.
          </p>
        </div>
        <div className="ag-table-scroll">
          <table className="ag-table">
            <thead>
              <tr>
                <th scope="col" className="table-head">
                  Name
                </th>
                <th scope="col" className="table-head">
                  Owner
                </th>
                <th scope="col" className="table-head max-lg:hidden">
                  App id
                </th>
                <th scope="col" className="table-head">
                  Creatives
                </th>
                <th scope="col" className="table-head">
                  Last turn
                </th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id} data-testid="admin-app-row">
                  <td className="table-cell table-cell-strong">
                    <Link href={`/apps/${app.id}`} className="ag-link-quiet">
                      <span className="ag-truncate" title={app.name}>
                        {app.name}
                      </span>
                    </Link>
                  </td>
                  <td className="table-cell">
                    {app.ownerUserId === null ? (
                      <span className="ag-badge ag-badge-warn">no owner</span>
                    ) : (
                      <span
                        className="ag-truncate"
                        title={emailById.get(app.ownerUserId) ?? app.ownerUserId}
                      >
                        {emailById.get(app.ownerUserId) ?? app.ownerUserId}
                      </span>
                    )}
                  </td>
                  <td className="table-cell ag-mono-2xs table-cell-nowrap max-lg:hidden">
                    {app.id}
                  </td>
                  <td className="table-cell">{app.creativeCount}</td>
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
      </div>
    </section>
  );
};

export default AdminPage;
