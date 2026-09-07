import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthCard } from '@/components/auth-card';
import { DocRef } from '@/components/doc-ref';
import { ADMIN_LOGIN_ERRORS, errorMessage, oneParam } from '@/lib/account-form';
import { currentSession, isConfigured } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/redirect';

/**
 * The operator's break-glass sign-in: one password, `ADMIN_PASSWORD`, no account row.
 *
 * It exists so an operator can never be locked out of their own deployment - an empty users
 * table, a deleted admin account, a database restored from a backup - and it is deliberately the
 * only login inside `/admin/**`, which is the path prefix `DASHBOARD_ALLOWED_IPS` guards. An
 * admin session can therefore only be obtained from an allowlisted address when that variable is
 * set, while signup and the member login stay reachable from anywhere.
 */

export const dynamic = 'force-dynamic';

const AdminLoginPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await searchParams;
  // Defaults to /apps, not /admin: signing in as the operator is how you reach the WHOLE console,
  // and /admin is one section of it. Middleware's `?from=` still wins when the visitor really was
  // heading for the operator page.
  const from = safeRedirectPath(oneParam(params['from']) || null);
  const configured = isConfigured();
  const session = configured ? await currentSession() : null;
  if (session !== null && session.role === 'admin') {
    redirect(from);
  }
  const error = configured
    ? errorMessage(ADMIN_LOGIN_ERRORS, params['error'])
    : ADMIN_LOGIN_ERRORS['unconfigured'];

  return (
    <AuthCard
      title="Operator sign-in"
      lede="The break-glass login for whoever runs this gateway. It reads ADMIN_PASSWORD and needs no account, so an empty or broken accounts table cannot lock you out."
      error={error}
      aside={
        <>
          Developer?{' '}
          <Link href="/login" className="ag-link">
            Sign in with your email
          </Link>
          .
        </>
      }
    >
      <form action="/api/admin/login" method="post" className="card space-y-4">
        <input type="hidden" name="from" value={from} />
        <div>
          <label htmlFor="password" className="ag-label-plain">
            Admin password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : 'auth-error'}
            className="ag-input mt-1"
          />
        </div>
        <button type="submit" className="ag-btn ag-btn-primary w-full">
          Sign in
        </button>
        <p className="ag-hint">
          Set <span className="ag-code">DASHBOARD_ALLOWED_IPS</span> and this form, and everything
          under <span className="ag-code">/admin</span>, answers 403 to any other address.
          Deployment guide: <DocRef doc="deploy" />.
        </p>
      </form>
    </AuthCard>
  );
};

export default AdminLoginPage;
