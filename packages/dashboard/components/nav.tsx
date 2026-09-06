'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The side rail (N3): wordmark, the four sections, the colour theme and sign out.
 *
 * ONE NAV ELEMENT AT EVERY WIDTH. Below 60rem the rail lies down as a bar with a
 * horizontally scrollable link strip; above it, it stands up as a sticky full height column
 * (app/globals.css). A second, hidden mobile copy would give the page two navigation
 * landmarks called "Sections" and two links called "Apps", which is wrong for a screen
 * reader before it is wrong for a test.
 *
 * Client component only because it highlights the current section from the pathname; the
 * pages themselves are server components. It imports nothing that reaches the database or
 * @adgate/core, because whatever this file pulls in is shipped to every page.
 */

export interface NavItem {
  href: string;
  label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/apps', label: 'Apps' },
  { href: '/creatives', label: 'Creatives' },
  { href: '/audit', label: 'Audit' },
  { href: '/reports', label: 'Reports' },
];

const isActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

export const Nav = () => {
  const pathname = usePathname();
  return (
    <header className="ag-rail no-print">
      <Link href="/apps" className="ag-wordmark">
        adgate<span className="ag-wordmark-mark">.</span>
      </Link>

      <nav aria-label="Sections" className="ag-rail-nav">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            className={`nav-link${isActive(pathname, item.href) ? ' nav-link-active' : ''}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="ag-rail-aside">
        <p className="ag-rail-meta">Read only · gateway database</p>
        <ThemeToggle />
        <form action="/api/logout" method="post">
          <button type="submit" className="ag-btn ag-btn-quiet">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
};
