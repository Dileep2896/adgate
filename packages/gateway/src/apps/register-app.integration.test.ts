import { loadPolicyFromYaml, policyHash, PolicyValidationError } from '@adgate/core';
import { PolicyConfig } from '@adgate/schemas';
import { count, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { API_KEY_PATTERN, parseApiKey, verifyApiSecret } from '../auth/keys.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { apiKeys, apps } from '../db/schema.js';
import { requireTestDatabaseUrl, truncateAllTables } from '../db/test-support.js';
import { findRepoRoot } from '../env-file.js';
import { defaultPolicyYaml, registerApp } from './register-app.js';

const url = requireTestDatabaseUrl();
let handle: DbHandle;

const rowCount = async (table: typeof apps | typeof apiKeys): Promise<number> => {
  const [row] = await handle.db.select({ n: count() }).from(table);
  return row?.n ?? 0;
};

beforeAll(async () => {
  await runMigrations(url);
  handle = createDb(url, { max: 2 });
  await truncateAllTables(handle.sql);
});

afterAll(async () => {
  await handle.close();
});

describe('registerApp', () => {
  it('inserts an app with the documented default policy and one app-role key', async () => {
    const { app, policy, key } = await registerApp(handle.db, { name: 'Default App' });
    expect(app.id).toMatch(/^app_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(app.name).toBe('Default App');
    expect(app.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(app.policyVersion).toBe(1);
    expect(app.affiliateConfig).toBeNull();

    // The stored YAML is the source of truth and hashes to what was written.
    const loaded = loadPolicyFromYaml(app.policyYaml);
    expect(app.policyHash).toBe(loaded.policy_hash);
    expect(app.policyHash).toBe(policyHash(PolicyConfig.parse({ app_id: app.id })));
    expect(policy).toEqual(loaded.policy);
    expect(policy.app_id).toBe(app.id);
    expect(app.policyYaml).toBe(defaultPolicyYaml(app.id));

    expect(key.role).toBe('app');
    expect(key.app_id).toBe(app.id);
    expect(key.advertiser_id).toBeNull();
    expect(key.key_id).toMatch(/^key_/);
    expect(key.api_key).toMatch(API_KEY_PATTERN);
    expect(parseApiKey(key.api_key)?.key_prefix).toBe(key.key_prefix);

    const [stored] = await handle.db.select().from(apiKeys).where(eq(apiKeys.id, key.key_id));
    expect(stored?.appId).toBe(app.id);
    expect(stored?.keyPrefix).toBe(key.key_prefix);
    expect(stored?.hashedKey).toMatch(/^\$argon2id\$/);
    expect(stored?.revokedAt).toBeNull();
    await expect(verifyApiSecret(stored?.hashedKey ?? '', key.secret)).resolves.toBe(true);

    const [persisted] = await handle.db.select().from(apps).where(eq(apps.id, app.id));
    expect(persisted).toEqual(app);
  });

  it('stores a supplied policy YAML verbatim with the hash loadPolicyFromYaml computes', async () => {
    const root = findRepoRoot();
    if (root === null) {
      throw new Error('repo root not found');
    }
    const yaml = readFileSync(join(root, 'examples', 'policy.example.yaml'), 'utf8');
    const { app, policy } = await registerApp(handle.db, { name: 'Yaml App', policyYaml: yaml });
    expect(app.policyYaml).toBe(yaml);
    expect(app.policyHash).toBe(loadPolicyFromYaml(yaml).policy_hash);
    expect(policy.app_id).toBe('example-chat');
    // The example spells out every default, so it hashes like the default policy for that id.
    expect(app.policyHash).toBe(policyHash(PolicyConfig.parse({ app_id: 'example-chat' })));
  });

  it('rejects an invalid policy and inserts nothing', async () => {
    const before = { apps: await rowCount(apps), keys: await rowCount(apiKeys) };
    await expect(
      registerApp(handle.db, {
        name: 'Bad',
        policyYaml: 'app_id: x\nblocked_categories: [health]\n',
      }),
    ).rejects.toBeInstanceOf(PolicyValidationError);
    await expect(
      registerApp(handle.db, { name: 'Bad', policyYaml: 'app_id: x\nnot_a_key: 1\n' }),
    ).rejects.toBeInstanceOf(PolicyValidationError);
    expect({ apps: await rowCount(apps), keys: await rowCount(apiKeys) }).toEqual(before);
  });

  it('rejects a blank name', async () => {
    await expect(registerApp(handle.db, { name: '   ' })).rejects.toBeInstanceOf(TypeError);
  });

  it('creates a second, distinct app when the same name is registered again', async () => {
    const first = await registerApp(handle.db, { name: 'Twice' });
    const second = await registerApp(handle.db, { name: 'Twice' });
    expect(second.app.id).not.toBe(first.app.id);
    expect(second.app.salt).not.toBe(first.app.salt);
    expect(second.key.api_key).not.toBe(first.key.api_key);
  });
});
