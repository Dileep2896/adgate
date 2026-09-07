import { NewAppForm } from '@/components/new-app-form';
import { requireSession } from '@/lib/auth';
import { oneParam } from '@/lib/account-form';
import { listAppsWithCounts } from '@/lib/queries';

/**
 * Register an app. The form and the "here is your API key, once" screen are one client
 * component: the key arrives as the server action's return value and lives only in its React
 * state (see components/new-app-form.tsx).
 *
 * `?welcome=1` is where signup lands (lib/routes.ts FIRST_APP_PATH). It is the same form with
 * the first-run words on it - and only when the account really has no apps yet, so reloading the
 * URL a week later does not greet an established developer as a newcomer.
 */

export const dynamic = 'force-dynamic';

const NewAppPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [session, params] = await Promise.all([requireSession('/apps/new'), searchParams]);
  const asked = oneParam(params['welcome']) !== '';
  const first = asked && (await listAppsWithCounts(session.scope)).length === 0;
  return <NewAppForm first={first} />;
};

export default NewAppPage;
