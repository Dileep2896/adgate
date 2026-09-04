import type { ReactNode } from 'react';

import { Nav } from '@/components/nav';
import { requireSession } from '@/lib/auth';

/**
 * The authenticated shell. Everything under this layout is behind requireSession(), which is
 * the real session check (middleware.ts only looks for the cookie). Reading cookies makes
 * every route below dynamic, which is what an operator dashboard wants anyway.
 */

const DashboardLayout = async ({ children }: { children: ReactNode }) => {
  await requireSession();
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <footer className="mx-auto w-full max-w-6xl px-6 pb-8 text-xs text-stone-400">
        adgate dashboard - read only view of the gateway database
      </footer>
    </div>
  );
};

export default DashboardLayout;
