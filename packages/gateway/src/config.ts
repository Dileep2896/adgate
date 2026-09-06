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
const nonNegativeInt = z.coerce.number().int().min(0);
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
  DB_STATEMENT_TIMEOUT_MS: nonNegativeInt.default(2000),
  DB_LOCK_TIMEOUT_MS: nonNegativeInt.default(1000),
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
  RATE_LIMIT_RPS: z.coerce.number().positive().default(20),
  RATE_LIMIT_BURST: positiveInt.default(40),
  RETENTION_INTERVAL_HOURS: nonNegativeInt.default(0),
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
  /** Per-session Postgres timeouts for createDb (db/client.ts); 0 disables one. */
  db: {
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS,
  },
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
  /** Per-API-key token bucket on the write endpoints (rate-limit/pg.ts): TokenBucketOptions. */
  rateLimit: { rps: env.RATE_LIMIT_RPS, burst: env.RATE_LIMIT_BURST },
  /**
   * How often the in-process retention scheduler runs (retention/scheduler.ts). 0 = never, and
   * the timer is not registered at all: run `pnpm --filter @adgate/gateway retention` from cron
   * instead. A free-tier deployment with nowhere to put a cron entry sets this instead.
   */
  retentionIntervalHours: env.RETENTION_INTERVAL_HOURS,
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
 * The values .env.example ships. They are placeholders, not secrets: a deployment still wearing
 * one is a copied file nobody edited. config.test.ts reads .env.example and fails if this map
 * drifts from it, so the check always means what it says.
 */
export const EXAMPLE_VALUES: Readonly<Record<string, string>> = Object.freeze({
  ADGATE_SIGNING_KEY_PEM: '',
  ADMIN_PASSWORD: 'change-me',
  METRICS_TOKEN: 'change-me',
});

/** Hosts that mean "this container". None of them is reachable from a user's browser. */
export const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

/**
 * PUBLIC_BASE_URL is the origin every creative click URL is built from (click/destination.ts).
 * A deployment that kept the local default hands every user a link to their own machine, and one
 * on http sends the audit id of a served ad over the wire in clear: both are silent, and both
 * only show up as "the ads work but nobody ever arrives".
 */
const publicBaseUrlIssues = (value: string): string[] => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return ['PUBLIC_BASE_URL: not a URL'];
  }
  const issues: string[] = [];
  if (LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) {
    issues.push(
      `PUBLIC_BASE_URL: ${url.hostname} is this machine, so every click URL points nowhere; set the externally reachable origin`,
    );
  }
  if (url.protocol !== 'https:') {
    issues.push(`PUBLIC_BASE_URL: must be https in production (got ${url.protocol.slice(0, -1)})`);
  }
  return issues;
};

/**
 * The checks that only apply to NODE_ENV=production, collected like every other configuration
 * problem: one ConfigError listing all of them, so a first deployment is fixed in one pass
 * instead of one restart per mistake. Everything here is a value that works locally and fails
 * silently in production, which is exactly the class of mistake a boot check is worth having.
 */
export const productionIssues = (config: GatewayConfig): string[] => {
  const issues = publicBaseUrlIssues(config.publicBaseUrl);
  if (config.signing.privatePem === EXAMPLE_VALUES['ADGATE_SIGNING_KEY_PEM']) {
    issues.push(`ADGATE_SIGNING_KEY_PEM: still the .env.example value (run \`${KEYGEN_COMMAND}\`)`);
  }
  if (config.adminPassword === EXAMPLE_VALUES['ADMIN_PASSWORD']) {
    issues.push('ADMIN_PASSWORD: still the .env.example placeholder; set a long random password');
  }
  if (config.metricsToken === EXAMPLE_VALUES['METRICS_TOKEN']) {
    issues.push(
      'METRICS_TOKEN: still the .env.example placeholder; set a random token or unset it',
    );
  }
  return issues;
};

/**
 * Production settings that are legitimate but usually not what the operator meant. Logged at
 * warn by server.ts and never fatal: a server-to-server deployment really has no browser origin,
 * and a deployment with no classifier key really does run rules only.
 */
export const configWarnings = (config: GatewayConfig): string[] => {
  if (config.nodeEnv !== 'production') {
    return [];
  }
  const warnings: string[] = [];
  if (config.corsAllowedOrigins.length === 0) {
    warnings.push(
      'CORS_ALLOWED_ORIGINS is empty: no browser may call the gateway directly, and a browser integration will fail with no CORS headers. Server-to-server callers are unaffected.',
    );
  }
  if (config.classifier === null) {
    warnings.push(
      'no classifier configured (CLASSIFIER_BASE_URL / CLASSIFIER_MODEL): classification is rules only, so intent is recognised from the keyword dictionary alone and fill will be narrower.',
    );
  }
  return warnings;
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
  if (result.data.nodeEnv === 'production') {
    const issues = productionIssues(result.data);
    if (issues.length > 0) {
      throw new ConfigError(issues);
    }
  }
  return result.data;
};
