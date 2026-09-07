import type { Sha256Hash } from '@adgateio/schemas';

import { sha256Prefixed } from './crypto.js';

/**
 * The two identity hashes of an audit record (docs/audit.md "Rules"): raw conversation ids are
 * never stored, and the user hash an app supplies is stored only in its normalised
 * `sha256:<hex>` form. Both take the app's salt: a per-app secret the gateway loads at boot and
 * never writes into a record. An empty or missing salt throws, so a misconfigured app fails
 * loudly instead of storing unsalted hashes.
 */

/** A SHA-256 digest as apps send it: 64 hex digits, with or without the sha256: prefix. */
const DIGEST_PATTERN = /^(?:sha256:)?([0-9a-f]{64})$/i;

/** `sha256:<lowercase hex>` when `value` is a SHA-256 digest in any accepted spelling, else null. */
export const normalizeSha256Hash = (value: unknown): Sha256Hash | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = DIGEST_PATTERN.exec(value)?.[1];
  return hex === undefined ? null : `sha256:${hex.toLowerCase()}`;
};

const requireSalt = (salt: string, fn: string): void => {
  if (typeof salt !== 'string' || salt.length === 0) {
    throw new TypeError(`${fn}: the app salt must be a non-empty string`);
  }
};

/** docs/audit.md: `conversation_id_hash` = sha256(app_salt + conversation_id). */
export const conversationIdHash = (salt: string, conversationId: string): Sha256Hash => {
  requireSalt(salt, 'conversationIdHash');
  if (typeof conversationId !== 'string' || conversationId.length === 0) {
    throw new TypeError('conversationIdHash: conversation_id must be a non-empty string');
  }
  return sha256Prefixed(`${salt}${conversationId}`);
};

/**
 * The record's `user_hash` from the request's optional `user.user_hash`: null when absent or
 * empty; a digest (64 hex digits, prefixed or bare, any case) is normalised to
 * `sha256:<lowercase hex>` and never re-hashed, so per-user caps key on the same value across
 * turns; anything else is treated as a raw identifier the app sent by mistake and is salted and
 * hashed like a conversation id, so it is never stored as sent.
 */
export const userHash = (salt: string, value: string | null | undefined): Sha256Hash | null => {
  requireSalt(salt, 'userHash');
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new TypeError('userHash: user_hash must be a string when present');
  }
  return normalizeSha256Hash(value) ?? sha256Prefixed(`${salt}${value}`);
};
