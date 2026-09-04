/**
 * The dashboard session: one signed cookie, no session table.
 *
 * The token is `v1.<expiry ms>.<base64url HMAC-SHA256(v1.<expiry ms>)>` signed with the
 * dashboard session secret (lib/env.ts). It carries nothing but its own expiry, so a stolen
 * cookie is worth exactly one login until it expires and rotating the secret (or the admin
 * password it falls back to) invalidates every outstanding session.
 *
 * Web Crypto only, no node built-ins: this module is imported by middleware.ts, which Next
 * runs in the Edge runtime. Nothing here reads process.env or the database.
 */

export const SESSION_COOKIE_NAME = 'adgate_dashboard_session';
export const SESSION_TOKEN_VERSION = 'v1';
/** How long a login lasts. Short enough that an unattended browser stops being a key. */
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * Compares two byte strings without an early exit. Lengths are compared first: every caller
 * here passes fixed-width digests, so the length carries no secret.
 */
export const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
};

const sha256 = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

const hmac = async (secret: string, payload: string): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
};

/**
 * Constant-time admin password check. Both sides are hashed to a fixed 32 bytes first, so the
 * comparison cannot leak the length of either one. The password is never logged or returned.
 */
export const verifyAdminPassword = async (
  presented: string,
  expected: string,
): Promise<boolean> => {
  if (expected === '') {
    return false;
  }
  const [presentedDigest, expectedDigest] = await Promise.all([
    sha256(presented),
    sha256(expected),
  ]);
  return constantTimeEqual(presentedDigest, expectedDigest);
};

/** Mints a token that stops being valid at `expiresAt`. */
export const signSessionToken = async (secret: string, expiresAt: Date): Promise<string> => {
  const payload = `${SESSION_TOKEN_VERSION}.${expiresAt.getTime()}`;
  return `${payload}.${toBase64Url(await hmac(secret, payload))}`;
};

/** Mints a token valid for `ttlMs` from `now`. */
export const issueSessionToken = async (
  secret: string,
  now: Date,
  ttlMs: number = DEFAULT_SESSION_TTL_MS,
): Promise<{ token: string; expiresAt: Date }> => {
  const expiresAt = new Date(now.getTime() + ttlMs);
  return { token: await signSessionToken(secret, expiresAt), expiresAt };
};

export type SessionFailure = 'missing' | 'malformed' | 'bad_signature' | 'expired';

export type SessionVerification =
  { valid: true; expiresAt: Date } | { valid: false; reason: SessionFailure };

/**
 * Verifies a cookie value. Never throws: an unparsable, forged or expired token is just an
 * unauthenticated request. The signature is checked before the expiry so a forged token can
 * never learn anything from the expiry branch.
 */
export const verifySessionToken = async (
  token: string | undefined | null,
  secret: string,
  now: Date,
): Promise<SessionVerification> => {
  if (token === undefined || token === null || token === '') {
    return { valid: false, reason: 'missing' };
  }
  const parts = token.split('.');
  const [version, expiry, signature] = parts;
  if (
    parts.length !== 3 ||
    version !== SESSION_TOKEN_VERSION ||
    expiry === undefined ||
    signature === undefined ||
    !/^[0-9]{1,15}$/.test(expiry)
  ) {
    return { valid: false, reason: 'malformed' };
  }
  const expected = toBase64Url(await hmac(secret, `${version}.${expiry}`));
  if (!constantTimeEqual(encoder.encode(signature), encoder.encode(expected))) {
    return { valid: false, reason: 'bad_signature' };
  }
  const expiresAt = new Date(Number(expiry));
  if (expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, expiresAt };
};
