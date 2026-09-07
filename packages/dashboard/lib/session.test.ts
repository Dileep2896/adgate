import { describe, expect, it } from 'vitest';

import {
  constantTimeEqual,
  DEFAULT_SESSION_TTL_MS,
  issueSessionToken,
  OPERATOR_USER_ID,
  SECRET_TAG_BYTES,
  secretTag,
  type SessionClaims,
  signSessionToken,
  verifyAdminPassword,
  verifySessionToken,
} from './session';

const SECRET = 'dashboard-session-secret-for-tests';
const NOW = new Date('2026-09-04T12:00:00.000Z');
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaA';

const MEMBER: SessionClaims = {
  userId: 'usr_01K4XG8Q0000000000000000',
  role: 'member',
  tag: 'tag0',
};

describe('constantTimeEqual', () => {
  it('is true only for identical bytes', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });
});

describe('verifyAdminPassword', () => {
  it('accepts only the exact password', async () => {
    await expect(verifyAdminPassword('hunter2!', 'hunter2!')).resolves.toBe(true);
    await expect(verifyAdminPassword('hunter2', 'hunter2!')).resolves.toBe(false);
    await expect(verifyAdminPassword('HUNTER2!', 'hunter2!')).resolves.toBe(false);
    await expect(verifyAdminPassword('', 'hunter2!')).resolves.toBe(false);
  });

  it('rejects everything when no password is configured', async () => {
    await expect(verifyAdminPassword('', '')).resolves.toBe(false);
    await expect(verifyAdminPassword('anything', '')).resolves.toBe(false);
  });
});

describe('secretTag', () => {
  it('is a short, url-safe digest that changes with the credential', async () => {
    const tag = await secretTag(HASH);
    expect(tag).toMatch(/^[A-Za-z0-9_-]+$/);
    // 16 bytes of base64url, unpadded.
    expect(tag).toHaveLength(Math.ceil((SECRET_TAG_BYTES * 4) / 3));
    expect(await secretTag(HASH)).toBe(tag);
    expect(await secretTag(`${HASH}x`)).not.toBe(tag);
  });

  it('never contains the credential it was made from', async () => {
    expect(await secretTag('a-plain-admin-password')).not.toContain('a-plain-admin-password');
  });
});

describe('session tokens', () => {
  it('round trips a freshly issued token with its claims', async () => {
    const { token, expiresAt } = await issueSessionToken(SECRET, MEMBER, NOW);
    expect(expiresAt.getTime()).toBe(NOW.getTime() + DEFAULT_SESSION_TTL_MS);
    expect(token.startsWith('v2.')).toBe(true);

    const result = await verifySessionToken(token, SECRET, NOW);
    expect(result).toEqual({ valid: true, expiresAt, claims: MEMBER });
  });

  it('carries the user id, the role and a tag, and nothing else', async () => {
    const { token } = await issueSessionToken(SECRET, MEMBER, NOW);
    expect(token).not.toContain(SECRET);
    expect(token.split('.')).toHaveLength(6);
    expect(token).toContain(MEMBER.userId);
    expect(token).toContain('.member.');
  });

  it('round trips the operator claims too', async () => {
    const claims: SessionClaims = {
      userId: OPERATOR_USER_ID,
      role: 'admin',
      tag: await secretTag('an-admin-password'),
    };
    const { token } = await issueSessionToken(SECRET, claims, NOW);
    const result = await verifySessionToken(token, SECRET, NOW);
    expect(result.valid && result.claims).toEqual(claims);
  });

  it('refuses to sign a claim the token could not carry back', async () => {
    await expect(
      signSessionToken(SECRET, { ...MEMBER, userId: 'usr.with.dots' }, NOW),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      signSessionToken(SECRET, { ...MEMBER, tag: 'tag with spaces' }, NOW),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a missing cookie', async () => {
    await expect(verifySessionToken(undefined, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'missing',
    });
    await expect(verifySessionToken('', SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'missing',
    });
  });

  it.each([
    ['not-a-token'],
    ['v2.123'],
    ['v3.123.usr_a.member.tag.sig'],
    ['v2.not-a-number.usr_a.member.tag.sig'],
    ['v2.123.usr_a.member.tag.sig.extra'],
    ['v2.123.usr_a.operator.tag.sig'],
    ['v2.123.usr.a.member.tag.sig'],
    // A v1 token: the single-password session this dashboard issued before accounts existed.
    ['v1.99999999999999.abc'],
  ])('rejects the malformed token %s', async (token) => {
    await expect(verifySessionToken(token, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'malformed',
    });
  });

  it('rejects a token signed with another secret', async () => {
    const { token } = await issueSessionToken('some-other-secret', MEMBER, NOW);
    await expect(verifySessionToken(token, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a token whose expiry was moved forward', async () => {
    const { token } = await issueSessionToken(SECRET, MEMBER, NOW);
    const signature = token.split('.')[5];
    const forged = `v2.${String(NOW.getTime() + 10 * DEFAULT_SESSION_TTL_MS)}.${MEMBER.userId}.member.${MEMBER.tag}.${String(signature)}`;
    await expect(verifySessionToken(forged, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a token whose role was rewritten to admin', async () => {
    const { token } = await issueSessionToken(SECRET, MEMBER, NOW);
    const parts = token.split('.');
    const forged = [parts[0], parts[1], parts[2], 'admin', parts[4], parts[5]].join('.');
    await expect(verifySessionToken(forged, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a token whose user id was swapped for another account', async () => {
    const { token } = await issueSessionToken(SECRET, MEMBER, NOW);
    const parts = token.split('.');
    const forged = [
      parts[0],
      parts[1],
      'usr_01K4XG8Q0000000000000001',
      parts[3],
      parts[4],
      parts[5],
    ].join('.');
    await expect(verifySessionToken(forged, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an expired token', async () => {
    const expired = await signSessionToken(SECRET, MEMBER, new Date(NOW.getTime() - 1));
    await expect(verifySessionToken(expired, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('treats the expiry instant itself as expired', async () => {
    const { token, expiresAt } = await issueSessionToken(SECRET, MEMBER, NOW);
    await expect(verifySessionToken(token, SECRET, expiresAt)).resolves.toEqual({
      valid: false,
      reason: 'expired',
    });
  });
});
