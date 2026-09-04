import { redirect } from 'next/navigation';

import { DEFAULT_LANDING_PATH } from '@/lib/redirect';

/** The dashboard has no separate home: Apps is the landing page. */
const HomePage = (): never => redirect(DEFAULT_LANDING_PATH);

export default HomePage;
