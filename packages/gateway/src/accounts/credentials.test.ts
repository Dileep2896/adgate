import { describe, expect, it } from 'vitest';

import {
  INVALID_CREDENTIALS_MESSAGE,
  isValidEmail,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  passwordIssues,
  USER_ID_PREFIX,
} from './credentials.js';

describe('normalizeEmail', () => {
  it('trims and lowercases, which is the form users.email is unique on', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(normalizeEmail('ada@example.com')).toBe('ada@example.com');
  });

  it('is idempotent, so a value read back normalizes to itself', () => {
    const once = normalizeEmail(' Grace@Example.Com ');
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe('isValidEmail', () => {
  it.each([
    'ada@example.com',
    'ada.lovelace+adgate@example.co.uk',
    'a@b.io',
    "o'hara@example.com",
    'ADA@EXAMPLE.COM',
    '  ada@example.com  ',
  ])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'ada',
    'ada@',
    '@example.com',
    'ada@example',
    'ada@@example.com',
    'ada@ example.com',
    'ada example@example.com',
    'ada@-example.com',
    'ada@example-.com',
    'ada@.example.com',
    'ada@example.com.',
    'ada<script>@example.com',
    'ada,bee@example.com',
  ])('refuses %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('refuses an address longer than RFC 5321 allows, and its local part', () => {
    const domain = '@example.com';
    expect(isValidEmail(`${'a'.repeat(MAX_EMAIL_LENGTH - domain.length)}${domain}`)).toBe(false);
    expect(isValidEmail(`${'a'.repeat(64)}${domain}`)).toBe(true);
    expect(isValidEmail(`${'a'.repeat(65)}${domain}`)).toBe(false);
  });
});

describe('passwordIssues', () => {
  it('accepts a password of exactly the minimum length and anything longer', () => {
    expect(passwordIssues('a'.repeat(MIN_PASSWORD_LENGTH))).toEqual([]);
    expect(passwordIssues('correct horse battery staple')).toEqual([]);
  });

  it('refuses anything shorter, naming the minimum', () => {
    const issues = passwordIssues('a'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('refuses a megabyte of text so nothing that long reaches argon2', () => {
    expect(passwordIssues('a'.repeat(MAX_PASSWORD_LENGTH))).toEqual([]);
    expect(passwordIssues('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toHaveLength(1);
  });

  it('has NO composition rules: no digit, symbol or case requirement', () => {
    expect(passwordIssues('aaaaaaaaaaaa')).toEqual([]);
    expect(passwordIssues('            ')).toEqual([]);
  });

  it('never repeats the password back in the message', () => {
    const password = 'hunter2';
    for (const issue of passwordIssues(password)) {
      expect(issue).not.toContain(password);
    }
  });
});

describe('the enumeration-safe error text', () => {
  it('says nothing about whether the account exists', () => {
    expect(INVALID_CREDENTIALS_MESSAGE).toBe('That email and password do not match an account.');
    expect(INVALID_CREDENTIALS_MESSAGE.toLowerCase()).not.toContain('no such');
    expect(INVALID_CREDENTIALS_MESSAGE.toLowerCase()).not.toContain('unknown');
    expect(INVALID_CREDENTIALS_MESSAGE.toLowerCase()).not.toContain('not found');
    expect(INVALID_CREDENTIALS_MESSAGE.toLowerCase()).not.toContain('wrong password');
  });
});

describe('USER_ID_PREFIX', () => {
  it('carries no dot: the session cookie splits its payload on one', () => {
    expect(USER_ID_PREFIX).toBe('usr_');
    expect(USER_ID_PREFIX).not.toContain('.');
  });
});
