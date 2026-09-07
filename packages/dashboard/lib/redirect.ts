/**
 * Where to send the browser after a successful login. Middleware puts the path the visitor
 * asked for in `?from=`, and that value comes back through a form field, so it is attacker
 * controlled: only a same-site absolute path is ever honoured, never a URL with a host.
 */

export const DEFAULT_LANDING_PATH = '/apps';

/** The forms themselves: landing on one would bounce the visitor straight back to it. */
const NEVER_LAND_ON = ['/login', '/signup', '/admin/login'] as const;

export const safeRedirectPath = (
  candidate: string | null | undefined,
  fallback: string = DEFAULT_LANDING_PATH,
): string => {
  if (typeof candidate !== 'string' || candidate === '') {
    return fallback;
  }
  // "/x" is ours; "//host", "/\\host", "https://host" and anything with a scheme are not.
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return fallback;
  }
  if (candidate.includes('\n') || candidate.includes('\r') || candidate.includes('\t')) {
    return fallback;
  }
  if (NEVER_LAND_ON.some((path) => candidate === path || candidate.startsWith(`${path}?`))) {
    return fallback;
  }
  return candidate;
};
