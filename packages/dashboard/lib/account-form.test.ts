import { INVALID_CREDENTIALS_MESSAGE, MIN_PASSWORD_LENGTH } from '@adgate/gateway/admin';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_LOGIN_ERRORS,
  errorMessage,
  LOGIN_ERRORS,
  oneParam,
  readCredentials,
  SIGNUP_ERRORS,
} from './account-form';

/**
 * The words the credential forms say, and the one rule that makes them safe: an unknown address
 * and a wrong password are indistinguishable.
 */

const form = (values: Record<string, unknown>) => ({
  get: (name: string) => values[name] ?? null,
});

describe('readCredentials', () => {
  it('trims the address and leaves the password exactly as typed', () => {
    expect(readCredentials(form({ email: '  Ada@Example.com ', password: '  spaces  ' }))).toEqual({
      email: 'Ada@Example.com',
      password: '  spaces  ',
    });
  });

  it('treats a missing or non-string field as empty rather than throwing', () => {
    expect(readCredentials(form({}))).toEqual({ email: '', password: '' });
    expect(readCredentials(form({ email: 42, password: null }))).toEqual({
      email: '',
      password: '',
    });
  });
});

describe('the sign-in error copy', () => {
  /**
   * THE ONE THAT MATTERS. The dashboard renders its own strings (the pages are server components
   * and must not pull argon2 in to show a sentence), so this holds the rendered words against
   * the gateway's constant. Two copies that could drift are how an enumeration hole gets
   * reintroduced by somebody being helpful.
   */
  it('says exactly what the gateway says for invalid credentials', () => {
    expect(LOGIN_ERRORS['invalid']).toBe(INVALID_CREDENTIALS_MESSAGE);
  });

  it('never distinguishes an unknown address from a wrong password', () => {
    const invalid = LOGIN_ERRORS['invalid'] ?? '';
    expect(invalid.toLowerCase()).not.toContain('no account');
    expect(invalid.toLowerCase()).not.toContain('unknown');
    expect(invalid.toLowerCase()).not.toContain('not registered');
    expect(invalid.toLowerCase()).not.toContain('incorrect password');
    // There is no second code that could leak the difference: the route only ever sends this one.
    expect(Object.keys(LOGIN_ERRORS).filter((key) => key.startsWith('invalid'))).toEqual([
      'invalid',
    ]);
  });

  it('quotes the real minimum in the signup copy', () => {
    expect(SIGNUP_ERRORS['weak_password']).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('has a message for every code the routes can send', () => {
    for (const code of [
      'invalid',
      'missing',
      'rate_limited',
      'forbidden',
      'unconfigured',
      'unavailable',
    ]) {
      expect(LOGIN_ERRORS[code], code).toBeTypeOf('string');
    }
    for (const code of [
      'invalid_email',
      'weak_password',
      'email_taken',
      'missing',
      'rate_limited',
      'forbidden',
      'unconfigured',
      'unavailable',
    ]) {
      expect(SIGNUP_ERRORS[code], code).toBeTypeOf('string');
    }
    for (const code of ['invalid', 'missing', 'rate_limited', 'forbidden', 'unconfigured']) {
      expect(ADMIN_LOGIN_ERRORS[code], code).toBeTypeOf('string');
    }
  });
});

describe('errorMessage and oneParam', () => {
  it('reads the first value of a repeated query parameter and ignores an unknown code', () => {
    expect(errorMessage(LOGIN_ERRORS, ['invalid', 'missing'])).toBe(LOGIN_ERRORS['invalid']);
    expect(errorMessage(LOGIN_ERRORS, 'not-a-code')).toBeUndefined();
    expect(errorMessage(LOGIN_ERRORS, undefined)).toBeUndefined();
    expect(oneParam(['a', 'b'])).toBe('a');
    expect(oneParam(undefined)).toBe('');
  });
});
