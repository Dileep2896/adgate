import { describe, expect, it } from 'vitest';

import {
  constantTimeEqual,
  DEFAULT_SESSION_TTL_MS,
  issueSessionToken,
  signSessionToken,
  verifyAdminPassword,
  verifySessionToken,
} from './session';

const SECRET = 'dashboard-session-secret-for-tests';
const NOW = new Date('2026-09-04T12:00:00.000Z');

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

describe('session tokens', () => {
  it('round trips a freshly issued token', async () => {
    const { token, expiresAt } = await issueSessionToken(SECRET, NOW);
    expect(expiresAt.getTime()).toBe(NOW.getTime() + DEFAULT_SESSION_TTL_MS);
    expect(token.startsWith('v1.')).toBe(true);

    const result = await verifySessionToken(token, SECRET, NOW);
    expect(result).toEqual({ valid: true, expiresAt });
  });

  it('carries nothing but the expiry', async () => {
    const { token } = await issueSessionToken(SECRET, NOW);
    expect(token).not.toContain(SECRET);
    expect(token.split('.')).toHaveLength(3);
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
    ['v1.123'],
    ['v2.123.abc'],
    ['v1.not-a-number.abc'],
    ['v1.123.abc.def'],
  ])('rejects the malformed token %s', async (token) => {
    await expect(verifySessionToken(token, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'malformed',
    });
  });

  it('rejects a token signed with another secret', async () => {
    const { token } = await issueSessionToken('some-other-secret', NOW);
    await expect(verifySessionToken(token, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a token whose expiry was moved forward', async () => {
    const { token } = await issueSessionToken(SECRET, NOW);
    const [, , signature] = token.split('.');
    const forged = `v1.${NOW.getTime() + 10 * DEFAULT_SESSION_TTL_MS}.${signature}`;
    await expect(verifySessionToken(forged, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an expired token', async () => {
    const expired = await signSessionToken(SECRET, new Date(NOW.getTime() - 1));
    await expect(verifySessionToken(expired, SECRET, NOW)).resolves.toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('treats the expiry instant itself as expired', async () => {
    const { token, expiresAt } = await issueSessionToken(SECRET, NOW);
    await expect(verifySessionToken(token, SECRET, expiresAt)).resolves.toEqual({
      valid: false,
      reason: 'expired',
    });
  });
});
