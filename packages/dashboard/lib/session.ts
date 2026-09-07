/**
 * The dashboard session: one signed cookie, no session table.
 *
 * The token is `v2.<expiry ms>.<user id>.<role>.<secret tag>.<base64url HMAC-SHA256 of everything
 * before it>`, signed with the dashboard session secret (lib/env.ts). Three facts travel in it:
 * WHO is signed in, WHAT they may see, and a digest of the credential the session was minted
 * against. Nothing else - no email, no name, no password.
 *
 * THE SECRET TAG IS WHAT MAKES A PASSWORD CHANGE END A SESSION. For a member it is a digest of
 * the stored argon2id hash; for the bootstrap operator it is a digest of ADMIN_PASSWORD. Changing
 * either produces a different hash, so lib/auth.ts - which reloads the account on every request -
 * sees a tag that no longer matches and treats the cookie as unauthenticated. A signed cookie
 * alone could not do that: it is valid until it expires by construction.
 *
 * Web Crypto only, no node built-ins: this module is imported by middleware.ts, which Next runs
 * in the Edge runtime. Nothing here reads process.env or the database, and nothing here decides
 * whether a session is good - it decides whether a token is authentic. lib/auth.ts is the gate.
 */

export const SESSION_COOKIE_NAME = 'adgate_dashboard_session';
export const SESSION_TOKEN_VERSION = 'v2';
/** How long a login lasts. Short enough that an unattended browser stops being a key. */
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * The two roles. `member` is a developer: their own apps, their own creatives, their own audit
 * records and reports. `admin` is the operator: everything, plus the gateway-wide numbers.
 */
export const SESSION_ROLES = ['member', 'admin'] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

/**
 * The user id of the ADMIN_PASSWORD login. It is not a row in `users` on purpose: the operator
 * must be able to get in when the users table is empty, wrong, or the account they made for
 * themselves is gone. SECURITY.md calls it the break-glass path.
 */
export const OPERATOR_USER_ID = 'operator';

/** Ids that may sit inside a token: no `.`, because the payload is split on one. */
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TAG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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

/** 16 bytes of SHA-256 over a credential: enough to detect a change, useless for reversing one. */
export const SECRET_TAG_BYTES = 16;

/**
 * The tag a session is bound to. Its input is an argon2id hash (already salted and one-way) or
 * ADMIN_PASSWORD; truncating the digest means a stolen cookie carries no usable material even
 * for an offline guess at a short password, while any change to the credential changes the tag.
 */
export const secretTag = async (credential: string): Promise<string> =>
  toBase64Url((await sha256(credential)).subarray(0, SECRET_TAG_BYTES));

/** Who the cookie says is signed in. */
export interface SessionClaims {
  userId: string;
  role: SessionRole;
  /** secretTag() of the credential this session was issued against. */
  tag: string;
}

const isRole = (value: string): value is SessionRole =>
  (SESSION_ROLES as readonly string[]).includes(value);

const payloadOf = (claims: SessionClaims, expiresAt: Date): string =>
  [SESSION_TOKEN_VERSION, String(expiresAt.getTime()), claims.userId, claims.role, claims.tag].join(
    '.',
  );

/** Mints a token that stops being valid at `expiresAt`. */
export const signSessionToken = async (
  secret: string,
  claims: SessionClaims,
  expiresAt: Date,
): Promise<string> => {
  if (!USER_ID_PATTERN.test(claims.userId) || !TAG_PATTERN.test(claims.tag)) {
    throw new TypeError('signSessionToken: a claim contains a character the token cannot carry');
  }
  const payload = payloadOf(claims, expiresAt);
  return `${payload}.${toBase64Url(await hmac(secret, payload))}`;
};

/** Mints a token valid for `ttlMs` from `now`. */
export const issueSessionToken = async (
  secret: string,
  claims: SessionClaims,
  now: Date,
  ttlMs: number = DEFAULT_SESSION_TTL_MS,
): Promise<{ token: string; expiresAt: Date }> => {
  const expiresAt = new Date(now.getTime() + ttlMs);
  return { token: await signSessionToken(secret, claims, expiresAt), expiresAt };
};

export type SessionFailure = 'missing' | 'malformed' | 'bad_signature' | 'expired';

export type SessionVerification =
  | { valid: true; expiresAt: Date; claims: SessionClaims }
  | { valid: false; reason: SessionFailure };

/**
 * Verifies a cookie value. Never throws: an unparsable, forged or expired token is just an
 * unauthenticated request. The signature is checked before the expiry so a forged token can
 * never learn anything from the expiry branch.
 *
 * A v1 token (the single-password sessions this dashboard issued before accounts existed) has
 * three parts and no version match, so it reads as `malformed` and its holder signs in again.
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
  const [version, expiry, userId, role, tag, signature] = parts;
  if (
    parts.length !== 6 ||
    version !== SESSION_TOKEN_VERSION ||
    expiry === undefined ||
    userId === undefined ||
    role === undefined ||
    tag === undefined ||
    signature === undefined ||
    !/^[0-9]{1,15}$/.test(expiry) ||
    !USER_ID_PATTERN.test(userId) ||
    !isRole(role) ||
    !TAG_PATTERN.test(tag)
  ) {
    return { valid: false, reason: 'malformed' };
  }
  const expected = toBase64Url(await hmac(secret, `${version}.${expiry}.${userId}.${role}.${tag}`));
  if (!constantTimeEqual(encoder.encode(signature), encoder.encode(expected))) {
    return { valid: false, reason: 'bad_signature' };
  }
  const expiresAt = new Date(Number(expiry));
  if (expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, expiresAt, claims: { userId, role, tag } };
};
