import { z } from 'zod';

/**
 * Audit signing keys (docs/audit.md): every record carries `key_id` and `signature`, and the
 * gateway verifies with a set of public keys keyed by key_id (ADGATE_PUBLIC_KEYS_JSON) that keeps
 * every retired key forever. The Ed25519 primitives live in @adgate/core (audit/crypto.ts);
 * this module only describes the on-the-wire and config shapes.
 */

/**
 * One safe token: the docs example is k_2026_09, local dev uses k_dev. No whitespace and no '='
 * so the verify detail `key_id=<id>` stays unambiguous.
 */
export const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const KeyId = z.string().regex(KEY_ID_PATTERN).meta({
  title: 'KeyId',
  description: 'Identifier of the Ed25519 key pair that signed a record, e.g. k_2026_09.',
});
export type KeyId = z.infer<typeof KeyId>;

/** `ed25519:` followed by standard base64 (with padding) of the 64 raw signature bytes. */
export const ED25519_SIGNATURE_PATTERN = /^ed25519:[A-Za-z0-9+/]+={0,2}$/;

export const Ed25519Signature = z.string().regex(ED25519_SIGNATURE_PATTERN).meta({
  title: 'Ed25519Signature',
  description:
    'An Ed25519 signature written as ed25519:<base64>, over the UTF-8 bytes of the record_hash string.',
});
export type Ed25519Signature = z.infer<typeof Ed25519Signature>;

/**
 * SPKI PEM as node:crypto exports it. Line breaks are required by the PEM decoder; inside a
 * JSON string they are written as \n escapes.
 */
export const PUBLIC_KEY_PEM_PATTERN =
  /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/;

export const PublicKeyPem = z.string().regex(PUBLIC_KEY_PEM_PATTERN).meta({
  title: 'PublicKeyPem',
  description: 'An Ed25519 public key as an SPKI PEM string (-----BEGIN PUBLIC KEY-----).',
});
export type PublicKeyPem = z.infer<typeof PublicKeyPem>;

export const PublicKeysJson = z.record(KeyId, PublicKeyPem).meta({
  title: 'PublicKeysJson',
  description:
    'Shape of ADGATE_PUBLIC_KEYS_JSON: key_id -> SPKI PEM public key, including every retired key (old public keys remain available for verification forever).',
});
export type PublicKeysJson = z.infer<typeof PublicKeysJson>;
