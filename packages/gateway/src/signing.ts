import {
  type AuditSigningKey,
  createKeyRing,
  derivePublicPem,
  keyFingerprint,
  loadPrivateKey,
  parsePublicKeysJson,
  type PublicKeyRing,
} from '@adgate/core';

import { ConfigError, type GatewayConfig } from './config.js';

/**
 * Boot-time key loading (S13 notes): the signing key is validated with loadPrivateKey, the
 * verification ring is built from ADGATE_PUBLIC_KEYS_JSON, and the signing key's own public
 * half is added under ADGATE_SIGNING_KEY_ID when the JSON lacks it, so the gateway's records
 * always verify. Nothing here runs on the request path; a bad key stops the process with a
 * ConfigError that names the variable and never echoes key material.
 */

export interface GatewaySigningKeys {
  signing: AuditSigningKey;
  ring: PublicKeyRing;
  /**
   * keyFingerprint() of the signing key's PUBLIC half, logged once at boot beside key_id. A
   * key_id is only a label an operator types: two deployments, or the same deployment after a
   * restored backup or a re-run key generator, can wear the same one over different key
   * material and nothing complains until records signed by the second key fail to verify. The
   * fingerprint makes that visible in a deploy log the moment it happens. Not a secret.
   */
  fingerprint: string;
}

const reason = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : 'unusable';

export const loadSigningKeys = (config: GatewayConfig['signing']): GatewaySigningKeys => {
  const issues: string[] = [];

  let publicPem: string | null = null;
  try {
    loadPrivateKey(config.privatePem);
    publicPem = derivePublicPem(config.privatePem);
  } catch (error) {
    issues.push(`ADGATE_SIGNING_KEY_PEM: ${reason(error)}`);
  }

  let keys: Record<string, string> = {};
  try {
    keys = { ...parsePublicKeysJson(config.publicKeysJson) };
  } catch (error) {
    issues.push(`ADGATE_PUBLIC_KEYS_JSON: ${reason(error)}`);
  }

  if (publicPem !== null) {
    const listed = keys[config.keyId];
    if (listed === undefined) {
      keys[config.keyId] = publicPem;
    } else if (listed.trim() !== publicPem.trim()) {
      issues.push(
        `ADGATE_PUBLIC_KEYS_JSON: the entry for ${config.keyId} is not the public half of ADGATE_SIGNING_KEY_PEM`,
      );
    }
  }

  if (issues.length > 0 || publicPem === null) {
    throw new ConfigError(issues);
  }

  // Computed from the public half only, and before the ring, so a fingerprint can never come
  // from a key the loader has not already accepted.
  const fingerprint = keyFingerprint(publicPem);

  try {
    return {
      signing: { key_id: config.keyId, private_pem: config.privatePem },
      ring: createKeyRing(keys),
      fingerprint,
    };
  } catch (error) {
    throw new ConfigError([`ADGATE_PUBLIC_KEYS_JSON: ${reason(error)}`]);
  }
};
