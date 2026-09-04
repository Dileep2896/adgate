import { NewAppForm } from '@/components/new-app-form';

/**
 * Register an app. The form and the "here is your API key, once" screen are one client
 * component: the key arrives as the server action's return value and lives only in its React
 * state (see components/new-app-form.tsx).
 */

export const dynamic = 'force-dynamic';

const NewAppPage = () => <NewAppForm />;

export default NewAppPage;
