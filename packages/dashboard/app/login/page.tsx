import { redirect } from 'next/navigation';

import { currentSession, isConfigured } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/redirect';

/**
 * The only public page. It posts to /api/login, which does the constant-time password check,
 * mints the signed session cookie and redirects. No JavaScript is required.
 *
 * `from` is where middleware.ts wanted to send the visitor; safeRedirectPath() makes sure it
 * can only ever be a path on this site.
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
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">adgate dashboard</h1>
        <p className="mt-1 mb-6 text-sm text-stone-500">Sign in with the admin password.</p>

        <form action="/api/login" method="post" className="card space-y-4">
          <input type="hidden" name="from" value={from} />
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-stone-700">
              Admin password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
            />
          </div>
          {error === undefined ? null : (
            <p role="alert" data-testid="login-error" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
};

export default LoginPage;
