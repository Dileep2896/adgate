import { randomBytes } from 'node:crypto';

import { loadPolicyFromYaml, prefixedUlid, type UlidOptions } from '@adgateio/core';
import type { PolicyConfig } from '@adgateio/schemas';

import { type IssuedApiKey, issueApiKey } from '../auth/repository.js';
import type { Db } from '../db/client.js';
import { type AppRow, apps } from '../db/tables/apps.js';

/**
 * Registers a tenant: one apps row (id, hash salt, stored policy YAML and its policy_hash,
 * policy_version 1) plus its first app-role API key, in one transaction. The policy is
 * validated with loadPolicyFromYaml before anything is written, so an invalid file throws
 * PolicyValidationError and leaves no row behind. Names are not unique: registering the
 * same name twice creates two apps.
 */

export const APP_ID_PREFIX = 'app_';
/** 32 random bytes, hex: the salt of conversationIdHash/userHash (docs/audit.md). */
export const APP_SALT_BYTES = 32;

export interface RegisterAppInput {
  name: string;
  /** The operator's policy document, stored verbatim. Omitted = the documented defaults. */
  policyYaml?: string | undefined;
  /**
   * The dashboard account this app belongs to, or null/omitted for an operator-created app.
   * A null owner is the CLI path (`create-app`) and is visible in the dashboard to admins only;
   * every dashboard read a member makes is filtered on this column.
   */
  ownerUserId?: string | null | undefined;
  ulid?: UlidOptions | undefined;
}

export interface RegisteredApp {
  app: AppRow;
  /** The fully defaulted policy the stored YAML parses to. */
  policy: PolicyConfig;
  /** The app-role key. Its api_key exists only here: print it once. */
  key: IssuedApiKey;
}

/** The stored policy of an app registered without a file: every field takes its default. */
export const defaultPolicyYaml = (appId: string): string =>
  [
    '# adgate policy. Every omitted field takes the documented default (docs/policy.md).',
    'version: 1',
    `app_id: ${appId}`,
    '',
  ].join('\n');

export const registerApp = async (db: Db, input: RegisterAppInput): Promise<RegisteredApp> => {
  const name = input.name.trim();
  if (name === '') {
    throw new TypeError('registerApp: name must not be blank');
  }
  const id = prefixedUlid(APP_ID_PREFIX, input.ulid);
  const policyYaml = input.policyYaml ?? defaultPolicyYaml(id);
  const { policy, policy_hash } = loadPolicyFromYaml(policyYaml);
  const salt = randomBytes(APP_SALT_BYTES).toString('hex');

  return db.transaction(async (tx) => {
    const [app] = await tx
      .insert(apps)
      .values({
        id,
        name,
        salt,
        policyYaml,
        policyHash: policy_hash,
        policyVersion: 1,
        ownerUserId: input.ownerUserId ?? null,
      })
      .returning();
    if (app === undefined) {
      throw new Error('registerApp: insert returned no row');
    }
    const key = await issueApiKey(tx, { appId: id, role: 'app', ulid: input.ulid });
    return { app, policy, key };
  });
};
