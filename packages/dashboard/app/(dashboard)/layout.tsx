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

const DashboardLayout = async ({ children }: { children: ReactNode }) => {
  await requireSession();
  return (
    <div className="ag-shell">
      <a href="#main" className="ag-skip no-print">
        Skip to content
      </a>
      <Nav />
      <div className="ag-column">
        <main id="main" className="ag-main">
          {children}
        </main>
        <footer className="ag-foot no-print">
          <span>adgate dashboard</span>
          <span>Read only view of the gateway database.</span>
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
