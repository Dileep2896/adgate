import type { ReactNode } from 'react';

import { DocRef } from '@/components/doc-ref';
import { Nav } from '@/components/nav';
import { requireSession } from '@/lib/auth';

/**
 * The authenticated shell. Everything under this layout is behind requireSession(), which is
 * the real session check (middleware.ts only looks for the cookie). Reading cookies makes
 * every route below dynamic, which is what an operator dashboard wants anyway.
 *
 * WORKBENCH SHAPE: a persistent instrument rail on the left, one content column that owns
 * its own sticky top bar (components/page-header.tsx), and a single hairline-ruled footer
 * line. The rail and the footer are `no-print`, so a verification report prints as the
 * document and nothing else.
 */

/**
 * NOTHING UNDER THIS LAYOUT IS EVER PRERENDERED. requireSession() reads the session cookie AND
 * the environment, and `next build` runs with NODE_ENV=production, where a placeholder
 * ADMIN_PASSWORD is a fatal configuration error (lib/admin-password.ts) - so a page Next tried
 * to render at build time would fail the build for a reason that has nothing to do with the
 * deployment. Every route below is dynamic anyway; saying it here makes it true for the
 * redirect-only `/` as well, which has no data of its own to mark dynamic.
 */
export const dynamic = 'force-dynamic';

const DashboardLayout = async ({ children }: { children: ReactNode }) => {
  const session = await requireSession();
  return (
    <div className="ag-shell">
      <a href="#main" className="ag-skip no-print">
        Skip to content
      </a>
      <Nav who={session.email ?? 'operator'} admin={session.role === 'admin'} />
      <div className="ag-column">
        <main id="main" className="ag-main">
          {children}
        </main>
        <footer className="ag-foot no-print">
          <span>adgate dashboard</span>
          <span>
            {session.role === 'admin'
              ? 'Operator view: every app on this gateway.'
              : 'Your apps, their creatives, their audit records.'}
          </span>
          <span>
            Wiring an app: <DocRef doc="integration" />
          </span>
          <span>
            Running the gateway: <DocRef doc="deploy" />
          </span>
        </footer>
      </div>
    </div>
  );
};

export default DashboardLayout;
