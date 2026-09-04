/**
 * Where to send the browser after a successful login. Middleware puts the path the visitor
 * asked for in `?from=`, and that value comes back through a form field, so it is attacker
 * controlled: only a same-site absolute path is ever honoured, never a URL with a host.
 */

export const DEFAULT_LANDING_PATH = '/apps';

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
  // The login page itself would bounce the visitor straight back to the form.
  if (candidate === '/login' || candidate.startsWith('/login?')) {
    return fallback;
  }
  return candidate;
};
