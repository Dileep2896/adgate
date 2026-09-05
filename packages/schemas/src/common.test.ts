import { describe, expect, it } from 'vitest';

import {
  AppId,
  AuditId,
  CreativeId,
  ErrorResponse,
  HealthResponse,
  IsoTimestamp,
  Message,
  MESSAGE_CONTENT_MAX_CHARS,
  SHA256_HASH_PATTERN,
  Sha256Hash,
  Surface,
  User,
} from './common.js';

describe('prefixed ids', () => {
  it('require their prefix and something after it', () => {
    expect(AppId.safeParse('app_01J').success).toBe(true);
    expect(AppId.safeParse('app_').success).toBe(false);
    expect(AppId.safeParse('aud_01J').success).toBe(false);
    expect(AuditId.safeParse('aud_01J').success).toBe(true);
    expect(AuditId.safeParse('cr_01J').success).toBe(false);
    expect(CreativeId.safeParse('cr_01J').success).toBe(true);
    expect(CreativeId.safeParse('01J').success).toBe(false);
  });
});

describe('Sha256Hash', () => {
  const digest = '0123456789abcdef'.repeat(4);

  it('requires the sha256: prefix followed by exactly 64 lowercase hex digits', () => {
    expect(Sha256Hash.safeParse(`sha256:${digest}`).success).toBe(true);
    expect(SHA256_HASH_PATTERN.test(`sha256:${digest}`)).toBe(true);
    for (const bad of [
      'sha256:abc',
      'sha256:',
      'abc',
      digest,
      `SHA256:${digest}`,
      `sha256:${digest.toUpperCase()}`,
      `sha256:${digest}0`,
      `sha256:${digest.slice(1)}`,
      `sha256:${digest.slice(1)}g`,
      ` sha256:${digest}`,
    ]) {
      expect(Sha256Hash.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('IsoTimestamp', () => {
  it('accepts UTC with a Z suffix only', () => {
    expect(IsoTimestamp.safeParse('2026-09-02T18:04:11Z').success).toBe(true);
    expect(IsoTimestamp.safeParse('2026-09-02T18:04:11.123Z').success).toBe(true);
    expect(IsoTimestamp.safeParse('2026-09-02T18:04:11+02:00').success).toBe(false);
    expect(IsoTimestamp.safeParse('2026-09-02T18:04:11').success).toBe(false);
    expect(IsoTimestamp.safeParse('2026-09-02').success).toBe(false);
  });
});

describe('Message', () => {
  it('accepts the chat roles and rejects others', () => {
    for (const role of ['system', 'user', 'assistant', 'tool']) {
      expect(Message.safeParse({ role, content: 'hi' }).success).toBe(true);
    }
    expect(Message.safeParse({ role: 'bot', content: 'hi' }).success).toBe(false);
    expect(Message.safeParse({ role: 'user' }).success).toBe(false);
  });

  it('caps content at MESSAGE_CONTENT_MAX_CHARS so one message cannot carry megabytes', () => {
    expect(MESSAGE_CONTENT_MAX_CHARS).toBe(32 * 1024);
    const atLimit = 'a'.repeat(MESSAGE_CONTENT_MAX_CHARS);
    expect(Message.safeParse({ role: 'user', content: atLimit }).success).toBe(true);
    expect(Message.safeParse({ role: 'user', content: `${atLimit}a` }).success).toBe(false);
    // Still far above the 4,000 characters the classifier reads (docs/api.md).
    expect(MESSAGE_CONTENT_MAX_CHARS).toBeGreaterThan(4000);
  });
});

describe('User', () => {
  it('requires tier and validates the optional region format', () => {
    expect(User.safeParse({ tier: 'free' }).success).toBe(true);
    expect(User.safeParse({ tier: 'paid', region: 'GB', locale: 'en-GB' }).success).toBe(true);
    expect(User.safeParse({ region: 'US' }).success).toBe(false);
    expect(User.safeParse({ tier: 'free', region: 'us' }).success).toBe(false);
    expect(User.safeParse({ tier: 'free', region: 'USA' }).success).toBe(false);
  });
});

describe('Surface', () => {
  it('defaults nothing and bounds max_creatives', () => {
    expect(Surface.parse({ type: 'cli', placement: 'after_answer' })).toEqual({
      type: 'cli',
      placement: 'after_answer',
    });
    expect(
      Surface.safeParse({ type: 'cli', placement: 'after_answer', max_creatives: 0 }).success,
    ).toBe(false);
    expect(
      Surface.safeParse({ type: 'cli', placement: 'after_answer', max_creatives: 1.5 }).success,
    ).toBe(false);
  });
});

describe('ErrorResponse and HealthResponse', () => {
  it('require the documented shapes', () => {
    expect(ErrorResponse.safeParse({ error: { code: 'unauthorized', message: '' } }).success).toBe(
      true,
    );
    expect(ErrorResponse.safeParse({ error: { code: '', message: 'x' } }).success).toBe(false);
    expect(ErrorResponse.safeParse({ error: 'unauthorized' }).success).toBe(false);
    expect(HealthResponse.safeParse({ ok: true }).success).toBe(true);
    expect(HealthResponse.safeParse({ ok: false }).success).toBe(false);
  });
});
