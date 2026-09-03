import { type IssuedApiKey, issueApiKey } from '../auth/repository.js';
import { isMainModule } from '../cli.js';
import { API_KEY_ROLES, type ApiKeyRole } from '../db/tables/apps.js';
import { optionalFlag, parseFlags, requireFlag, UsageError } from './args.js';
import { connectFromEnv, runScript } from './run.js';

/**
 * `pnpm --filter @adgate/gateway create-key --app <app_id> --role app|advertiser_read
 * [--advertiser <adv_id>]`: issues one more API key for an existing app and prints it once.
 */

export const CREATE_KEY_USAGE = [
  'usage: create-key --app <app_id> --role app|advertiser_read [--advertiser <adv_id>]',
  '',
  '  --app         The app the key belongs to (app_...).',
  '  --role        app: evaluate, attest, events and its own audit records.',
  '                advertiser_read: read and verify records that reference one advertiser.',
  '  --advertiser  The advertiser (adv_...) an advertiser_read key may read. Required for that',
  '                role, not allowed for role app.',
  '',
  'Connects to DATABASE_URL (from the environment or the repo-root .env).',
  '',
].join('\n');

export type CreateKeyArgs =
  { help: true } | { help: false; appId: string; role: ApiKeyRole; advertiserId: string | null };

const isRole = (value: string): value is ApiKeyRole =>
  (API_KEY_ROLES as readonly string[]).includes(value);

export const parseCreateKeyArgs = (argv: readonly string[]): CreateKeyArgs => {
  const { help, flags } = parseFlags(argv, {
    app: 'string',
    role: 'string',
    advertiser: 'string',
  });
  if (help) {
    return { help: true };
  }
  const appId = requireFlag(flags, 'app');
  const role = requireFlag(flags, 'role');
  if (!isRole(role)) {
    throw new UsageError(`--role must be one of ${API_KEY_ROLES.join(', ')}`);
  }
  const advertiserId = optionalFlag(flags, 'advertiser');
  if (role === 'advertiser_read' && advertiserId === null) {
    throw new UsageError('--advertiser is required for role advertiser_read');
  }
  if (role === 'app' && advertiserId !== null) {
    throw new UsageError('--advertiser is only valid for role advertiser_read');
  }
  return { help: false, appId, role, advertiserId };
};

export const renderCreateKeyOutput = (key: IssuedApiKey): string =>
  [
    `API key created (role ${key.role}, key_id ${key.key_id}, app ${key.app_id}${
      key.advertiser_id === null ? '' : `, advertiser ${key.advertiser_id}`
    }).`,
    'This is the ONLY time it is shown: adgate stores an argon2id hash and cannot retrieve it again.',
    '',
    `  ${key.api_key}`,
    '',
    'Send it as: Authorization: Bearer <api_key>',
    '',
  ].join('\n');

const main = async (argv: readonly string[]): Promise<string> => {
  const args = parseCreateKeyArgs(argv);
  if (args.help) {
    return CREATE_KEY_USAGE;
  }
  const handle = connectFromEnv();
  try {
    const key = await issueApiKey(handle.db, {
      appId: args.appId,
      role: args.role,
      advertiserId: args.advertiserId,
    });
    return renderCreateKeyOutput(key);
  } finally {
    await handle.close();
  }
};

if (isMainModule(import.meta.url)) {
  await runScript({ usage: CREATE_KEY_USAGE, main }, process.argv.slice(2));
}
