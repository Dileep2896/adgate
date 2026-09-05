'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The dashboard nav. Client component only because it highlights the current section from the
 * pathname; the pages themselves are server components.
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
    <header className="no-print border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/apps" className="text-sm font-semibold tracking-tight text-stone-900">
          adgate
        </Link>
        <nav aria-label="Sections" className="flex items-center gap-1">
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
        <form action="/api/logout" method="post" className="ml-auto">
          <button
            type="submit"
            className="text-sm text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
};
