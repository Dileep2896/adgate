import {
  type AuditSigningKey,
  createKeyRing,
  derivePublicPem,
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

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  try {
    return {
      signing: { key_id: config.keyId, private_pem: config.privatePem },
      ring: createKeyRing(keys),
    };
  } catch (error) {
    throw new ConfigError([`ADGATE_PUBLIC_KEYS_JSON: ${reason(error)}`]);
  }
};
