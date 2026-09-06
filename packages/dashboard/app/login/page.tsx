import { redirect } from 'next/navigation';

import { DocRef } from '@/components/doc-ref';
import { ThemeToggle } from '@/components/theme-toggle';
import { currentSession, isConfigured } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/redirect';

/**
 * The only public page. It posts to /api/login, which does the constant-time password check,
 * mints the signed session cookie and redirects. No JavaScript is required.
 *
 * `from` is where middleware.ts wanted to send the visitor; safeRedirectPath() makes sure it
 * can only ever be a path on this site.
 *
 * The theme toggle is here as well as in the rail: an operator who has not signed in yet is
 * still an operator with a preference, and the choice is stored before the session exists.
 */

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'That password is not right.',
  missing: 'Enter the admin password.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  unconfigured: 'The dashboard has no ADMIN_PASSWORD set. See .env.example.',
};

const LoginPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await searchParams;
  const from = safeRedirectPath(typeof params['from'] === 'string' ? params['from'] : null);
  // An unconfigured dashboard has no session secret to check against; show the form and let
  // the error line say so rather than rendering a stack trace.
  const configured = isConfigured();
  if (configured && (await currentSession()) !== null) {
    redirect(from);
  }
  const errorKey = configured && typeof params['error'] === 'string' ? params['error'] : '';
  const error = ERRORS[configured ? errorKey : 'unconfigured'];

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="ag-wordmark">
          adgate<span className="ag-wordmark-mark">.</span>
        </p>
        <h1 className="mt-4 text-lg font-semibold">Operator dashboard</h1>
        <p className="mt-1 mb-5 text-xs text-ink-3">
          Apps, creatives, the signed audit chain and verification reports for one gateway. One
          password, one operator.
        </p>

        <form action="/api/login" method="post" className="card space-y-4">
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
              aria-describedby={error === undefined ? undefined : 'login-error'}
              className="ag-input mt-1"
            />
          </div>
          {error === undefined ? null : (
            <p id="login-error" role="alert" data-testid="login-error" className="ag-field-error">
              {error}
            </p>
          )}
          <button type="submit" className="ag-btn ag-btn-primary w-full">
            Sign in
          </button>
        </form>

        <div className="ag-meta mt-5 justify-between">
          <span>
            Deployment guide: <DocRef doc="deploy" />
          </span>
          <ThemeToggle />
        </div>
      </div>
    </main>
  );
};

export default LoginPage;
