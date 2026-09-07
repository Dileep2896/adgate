import { readFileSync } from 'node:fs';

import { type RegisteredApp, registerApp } from '../apps/register-app.js';
import { isMainModule } from '../cli.js';
import { optionalFlag, parseFlags, requireFlag } from './args.js';
import { connectFromEnv, runScript } from './run.js';

/**
 * `pnpm --filter @adgateio/gateway create-app --name <name> [--policy <policy.yaml>]`:
 * registers an app and prints its id and its first app-role API key. The key is printed
 * exactly once; only an argon2id hash is stored, so it can never be shown again.
 */

export const CREATE_APP_USAGE = [
  'usage: create-app --name <name> [--policy <policy.yaml>]',
  '',
  '  --name     Display name of the app (not unique: the same name again creates another app).',
  '  --policy   Path to a docs/policy.md YAML file, stored verbatim. Omitted = the documented defaults.',
  '',
  'Connects to DATABASE_URL (from the environment or the repo-root .env).',
  '',
].join('\n');

export type CreateAppArgs = { help: true } | { help: false; name: string; policyPath?: string };

export const parseCreateAppArgs = (argv: readonly string[]): CreateAppArgs => {
  const { help, flags } = parseFlags(argv, { name: 'string', policy: 'string' });
  if (help) {
    return { help: true };
  }
  const name = requireFlag(flags, 'name');
  const policyPath = optionalFlag(flags, 'policy');
  return policyPath === null ? { help: false, name } : { help: false, name, policyPath };
};

export const renderCreateAppOutput = (result: RegisteredApp): string =>
  [
    'App created',
    `  app_id:         ${result.app.id}`,
    `  name:           ${result.app.name}`,
    `  policy_hash:    ${result.app.policyHash}`,
    `  policy_version: ${result.app.policyVersion}`,
    '',
    `API key (role ${result.key.role}, key_id ${result.key.key_id}). This is the ONLY time it is shown:`,
    'adgate stores an argon2id hash and cannot retrieve the key again. Copy it now.',
    '',
    `  ${result.key.api_key}`,
    '',
    'Send it as: Authorization: Bearer <api_key>',
    '',
  ].join('\n');

const main = async (argv: readonly string[]): Promise<string> => {
  const args = parseCreateAppArgs(argv);
  if (args.help) {
    return CREATE_APP_USAGE;
  }
  const policyYaml =
    args.policyPath === undefined ? undefined : readFileSync(args.policyPath, 'utf8');
  const handle = connectFromEnv();
  try {
    const result = await registerApp(handle.db, { name: args.name, policyYaml });
    return renderCreateAppOutput(result);
  } finally {
    await handle.close();
  }
};

if (isMainModule(import.meta.url)) {
  await runScript({ usage: CREATE_APP_USAGE, main }, process.argv.slice(2));
}
