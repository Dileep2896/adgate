/** Why a key or key set was rejected. Config-time only; the request path never sees it. */
export type AuditKeyErrorReason =
  | 'invalid_json'
  | 'invalid_shape'
  | 'invalid_key_id'
  | 'invalid_public_key'
  | 'invalid_private_key';

/**
 * Thrown by sign and derivePublicPem (unusable private key), generateKeypair (bad key_id),
 * createKeyRing and parsePublicKeysJson (bad key set). Like PolicyValidationError it belongs
 * to boot and config code: load and validate keys once at startup so nothing on the
 * /v1/evaluate path can throw it. Messages never contain key material; key_id is the only
 * input echoed back.
 */
export class AuditKeyError extends Error {
  override readonly name = 'AuditKeyError';
  readonly reason: AuditKeyErrorReason;
  readonly key_id: string | undefined;

  constructor(reason: AuditKeyErrorReason, message: string, key_id?: string) {
    super(key_id === undefined ? message : `${message} (key_id=${key_id})`);
    this.reason = reason;
    this.key_id = key_id;
  }
}
