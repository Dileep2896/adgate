/**
 * The rules a dashboard account's email and password have to satisfy, and the words the
 * dashboard says when they do not. PURE: no database, no argon2, no clock, no env, so the rules
 * can be unit tested on their own and reused by a form that has not touched Postgres yet.
 *
 * ONE ERROR STRING FOR BOTH SIGN-IN FAILURES. `INVALID_CREDENTIALS_MESSAGE` is what an unknown
 * email and a wrong password both produce, and authenticateUser() spends the same argon2 time on
 * each (accounts/users.ts). Saying "no such account" would turn the login form into an oracle
 * for which addresses have signed up, which is the kind of list that gets sold.
 */

/** usr_ ULID. The dashboard session cookie carries this value, so it may contain no `.`. */
export const USER_ID_PREFIX = 'usr_';

/**
 * Twelve characters, and nothing else. No composition rules: NIST SP 800-63B has been telling
 * people to drop them since 2017, they push users towards `Passw0rd!`, and length is the only
 * requirement that reliably buys entropy. The upper bound only exists so a megabyte of text
 * cannot be posted at argon2.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

/** RFC 5321's limit on the whole address; the local part is capped separately at 64. */
export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

/**
 * Deliberately not an RFC 5322 grammar: an address that reaches a real mailbox is a question for
 * an email provider (there is none in this change), and an over-clever regex refuses valid
 * addresses. This rejects the shapes that are certainly wrong - no `@`, more than one, spaces,
 * an empty side, a domain with no dot or a leading/trailing dot or hyphen - and accepts the rest.
 */
const EMAIL_PATTERN =
  /^[^\s@,;<>"]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/**
 * The stored form of an address: trimmed and lowercased. `users.email` is unique on exactly this
 * value, so every read and every write must go through this function or two accounts could share
 * one address in different cases.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** True when the normalized address is one this dashboard will store. */
export const isValidEmail = (email: string): boolean => {
  const normalized = normalizeEmail(email);
  if (normalized.length === 0 || normalized.length > MAX_EMAIL_LENGTH) {
    return false;
  }
  const local = normalized.slice(0, normalized.indexOf('@'));
  if (local.length > MAX_LOCAL_LENGTH) {
    return false;
  }
  return EMAIL_PATTERN.test(normalized);
};

/** Why this password is refused, in the words the form shows. Empty = acceptable. */
export const passwordIssues = (password: string): string[] => {
  const issues: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    issues.push(
      `Use at least ${String(MIN_PASSWORD_LENGTH)} characters. Length is the only rule: a passphrase of ordinary words beats a short one with punctuation in it.`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    issues.push(`Use at most ${String(MAX_PASSWORD_LENGTH)} characters.`);
  }
  return issues;
};

/** What a signup or a sign-in can go wrong with. Every one is safe to show a stranger. */
export const INVALID_EMAIL_MESSAGE = 'Enter an email address like you@example.com.';
export const EMAIL_TAKEN_MESSAGE =
  'That email already has an account. Sign in instead, or use another address.';
/**
 * THE SAME SENTENCE for an unknown email and a wrong password. Anything that distinguished them
 * would let a stranger enumerate the accounts on this deployment one address at a time.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'That email and password do not match an account.';
