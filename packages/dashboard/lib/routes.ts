/**
 * Which paths are public, which are the operator's, and where an anonymous visitor is sent.
 *
 * EDGE SAFE AND DEPENDENCY FREE, like lib/client-address.ts and lib/session.ts: middleware.ts
 * imports it, and middleware is compiled for Next's Edge runtime, where a node built-in - or a
 * module that transitively reaches one - fails the build.
 *
 * THE ADMIN SURFACE IS A PATH PREFIX, and that is what makes the network allowlist expressible.
 * `DASHBOARD_ALLOWED_IPS` now guards `/admin/**` only: the operator's own view and the
 * break-glass ADMIN_PASSWORD form. Signup, the member login and every member route are reachable
 * from anywhere, because a developer console that only their office IP can sign up to is not a
 * developer console. An admin session can therefore only be OBTAINED from an allowlisted
 * address; it is then usable on the shared routes like any other session.
 */

/** Signed-in visitors land here. */
export const DEFAULT_LANDING = '/apps';

/** The member login form, and the fallback for any protected path outside /admin. */
export const LOGIN_ROUTE = '/login';
/** The break-glass ADMIN_PASSWORD form. Inside the admin surface, so the allowlist covers it. */
export const ADMIN_LOGIN_ROUTE = '/admin/login';
export const SIGNUP_ROUTE = '/signup';
/** The operator's view over every account and every app. */
export const ADMIN_ROUTE = '/admin';
/** Where a brand new account lands: create your first app, then take its key and the snippets. */
export const FIRST_APP_PATH = '/apps/new?welcome=1';

/** Reachable with no session at all. Everything else needs one. */
export const PUBLIC_PATHS: readonly string[] = [
  LOGIN_ROUTE,
  SIGNUP_ROUTE,
  ADMIN_LOGIN_ROUTE,
  '/api/login',
  '/api/signup',
  '/api/admin/login',
  '/api/logout',
];

const PUBLIC = new Set(PUBLIC_PATHS);

export const isPublicPath = (pathname: string): boolean => PUBLIC.has(pathname);

/**
 * The operator surface: `/admin`, anything under it, and the admin login endpoint that mints an
 * operator session. These are the paths DASHBOARD_ALLOWED_IPS refuses from off-list addresses.
 */
export const isAdminOnlyPath = (pathname: string): boolean =>
  pathname === ADMIN_ROUTE ||
  pathname.startsWith(`${ADMIN_ROUTE}/`) ||
  pathname === '/api/admin/login' ||
  pathname.startsWith('/api/admin/');

/** The form to send an anonymous visitor to, for the path they were trying to reach. */
export const loginRouteFor = (pathname: string): string =>
  isAdminOnlyPath(pathname) ? ADMIN_LOGIN_ROUTE : LOGIN_ROUTE;
