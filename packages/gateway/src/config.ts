import { GravityConfig, KEY_ID_PATTERN, KoahConfig } from '@adgate/schemas';
import { z } from 'zod';

/**
 * Gateway configuration: one Zod schema over the environment, parsed once at boot by
 * loadConfig(). Every variable is documented in .env.example. Core never reads env vars, so
 * this is the only place that knows their names; the rest of the gateway receives the typed
 * GatewayConfig. Parsing fails fast with a ConfigError that lists every missing or invalid
 * variable by name, so a misconfigured deployment never starts half-working.
 */

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const NODE_ENVS = ['development', 'test', 'production'] as const;

export const KEYGEN_COMMAND = 'pnpm --filter @adgate/gateway keygen';

/** Restores the line breaks of a PEM whose newlines were flattened to `\n` escapes. */
export const unescapeNewlines = (value: string): string => value.replace(/\\n/g, '\n');

const nonEmpty = z.string().min(1);
const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();
const envBool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');
const commaList = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== ''),
);

/** The raw environment, one entry per .env.example variable. Blank values arrive as undefined. */
export const GatewayEnv = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: port.default(8787),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: nonEmpty,
  DATABASE_URL_TEST: nonEmpty.optional(),
  CORS_ALLOWED_ORIGINS: commaList.default([]),
  PUBLIC_BASE_URL: z.url().default('http://localhost:8787'),
  METRICS_TOKEN: nonEmpty.optional(),
  ADMIN_PASSWORD: nonEmpty.optional(),
  ADGATE_SIGNING_KEY_ID: z.string().regex(KEY_ID_PATTERN),
  ADGATE_SIGNING_KEY_PEM: nonEmpty.transform(unescapeNewlines),
  ADGATE_PUBLIC_KEYS_JSON: nonEmpty.default('{}'),
  CLASSIFIER_BASE_URL: nonEmpty.optional(),
  CLASSIFIER_API_KEY: nonEmpty.optional(),
  CLASSIFIER_MODEL: nonEmpty.optional(),
  CLASSIFIER_TIMEOUT_MS: positiveInt.default(400),
  KOAH_ENABLED: envBool.default(false),
  KOAH_API_KEY: nonEmpty.optional(),
  KOAH_BASE_URL: nonEmpty.optional(),
  GRAVITY_ENABLED: envBool.default(false),
  GRAVITY_API_KEY: nonEmpty.optional(),
  GRAVITY_BASE_URL: nonEmpty.optional(),
});
export type GatewayEnv = z.infer<typeof GatewayEnv>;

const networkConfig = (
  enabled: boolean,
  api_key: string | undefined,
  base_url: string | undefined,
) => ({
  enabled,
  ...(api_key === undefined ? {} : { api_key }),
  ...(base_url === undefined ? {} : { base_url }),
});

/** The typed configuration the gateway runs on, derived from GatewayEnv. */
export const GatewayConfig = GatewayEnv.transform((env) => ({
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  databaseUrlTest: env.DATABASE_URL_TEST ?? null,
  corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  metricsToken: env.METRICS_TOKEN ?? null,
  adminPassword: env.ADMIN_PASSWORD ?? null,
  /** Loaded into key objects by loadSigningKeys() (signing.ts) at boot. */
  signing: {
    keyId: env.ADGATE_SIGNING_KEY_ID,
    privatePem: env.ADGATE_SIGNING_KEY_PEM,
    publicKeysJson: env.ADGATE_PUBLIC_KEYS_JSON,
  },
  /** null = no LLM configured: the classifier runs rules only. Matches LlmClassifierConfig. */
  classifier:
    env.CLASSIFIER_BASE_URL !== undefined && env.CLASSIFIER_MODEL !== undefined
      ? {
          baseUrl: env.CLASSIFIER_BASE_URL,
          apiKey: env.CLASSIFIER_API_KEY ?? '',
          model: env.CLASSIFIER_MODEL,
          timeoutMs: env.CLASSIFIER_TIMEOUT_MS,
        }
      : null,
  classifierTimeoutMs: env.CLASSIFIER_TIMEOUT_MS,
  koah: KoahConfig.parse(networkConfig(env.KOAH_ENABLED, env.KOAH_API_KEY, env.KOAH_BASE_URL)),
  gravity: GravityConfig.parse(
    networkConfig(env.GRAVITY_ENABLED, env.GRAVITY_API_KEY, env.GRAVITY_BASE_URL),
  ),
}));
export type GatewayConfig = z.infer<typeof GatewayConfig>;

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Thrown by loadConfig and loadSigningKeys. `issues` has one readable line per problem. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      [
        'Invalid gateway configuration:',
        ...issues.map((issue) => `  - ${issue}`),
        'See .env.example for every variable.',
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** What to do about a missing or invalid variable, appended to its issue line. */
const HINTS: Readonly<Record<string, string>> = {
  DATABASE_URL:
    'e.g. postgres://adgate:adgate@localhost:5432/adgate after `docker compose up -d postgres`',
  ADGATE_SIGNING_KEY_ID: `the key_id printed by \`${KEYGEN_COMMAND}\`, e.g. k_2026_09`,
  ADGATE_SIGNING_KEY_PEM: `generate a key pair with \`${KEYGEN_COMMAND}\` and paste the printed lines into .env`,
  ADGATE_PUBLIC_KEYS_JSON: 'JSON object of key_id -> public key PEM with \\n escapes; {} is fine',
};

/** Drops blank values so "VAR=" in a .env file means "not set" and never passes min(1). */
const compact = (env: EnvSource): Record<string, string> => {
  const present: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') {
      present[key] = value;
    }
  }
  return present;
};

const describeIssue = (issue: z.core.$ZodIssue, present: Record<string, string>): string => {
  const name = issue.path.map(String).join('.') || '(root)';
  const missing = issue.path.length === 1 && present[name] === undefined;
  const hint = HINTS[name];
  const detail = missing ? 'missing' : issue.message;
  return hint === undefined ? `${name}: ${detail}` : `${name}: ${detail} (${hint})`;
};

/**
 * Parses the environment into a GatewayConfig. Pass an object to parse something other than
 * process.env (tests never touch the real environment). Throws ConfigError.
 */
export const loadConfig = (env: EnvSource = process.env): GatewayConfig => {
  const present = compact(env);
  const result = GatewayConfig.safeParse(present);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => describeIssue(issue, present)));
  }
  return result.data;
};
