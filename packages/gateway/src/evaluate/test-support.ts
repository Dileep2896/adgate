import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { creativeContentHash, generateKeypair, verify, type VerifyContext } from '@adgate/core';
import {
  ClassifyFixture,
  type ClassifyFixtureCase,
  type EvaluateRequest,
  EvaluateResponse,
  SeedCreative,
  type VerifyResponse,
} from '@adgate/schemas';
import { asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import type { z } from 'zod';

import { type App, createApp } from '../app.js';
import { type RegisteredApp, registerApp } from '../apps/register-app.js';
import { seedCreatives } from '../catalog/seed.js';
import { type GatewayConfig, loadConfig } from '../config.js';
import { createDb, type DbHandle, type DbOptions } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { advertisers, auditRecords, creatives } from '../db/schema.js';
import { requireTestDatabaseUrl, truncateAllTables } from '../db/test-support.js';
import { findRepoRoot } from '../env-file.js';
import { createLogger, type LogLevel } from '../logger.js';
import type { RateLimiter, TokenBucketOptions } from '../rate-limit/limiter.js';
import { createPgRateLimiter } from '../rate-limit/pg.js';
import { type GatewaySigningKeys, loadSigningKeys } from '../signing.js';
import { collectLogs } from '../test-support/logs.js';
import { createEvaluateDeps, type EvaluateDeps, type EvaluateDepsOverrides } from './deps.js';

/**
 * Shared harness of the /v1/evaluate integration tests: the test database (migrated, truncated),
 * one registered app with its key, the example catalog, a config built through loadConfig with
 * a generated signing key, and the Hono app wired with createEvaluateDeps plus any injected
 * collaborator. Not a test file (importing a *.test.ts re-registers its tests).
 */
export const PUBLIC_BASE_URL = 'https://gateway.test';
export const KEY_ID = 'k_test';

const root = findRepoRoot();
if (root === null) {
  throw new Error('repo root not found');
}
const pair = generateKeypair({ keyId: KEY_ID });

export const fixtureCases: readonly ClassifyFixtureCase[] = ClassifyFixture.parse(
  JSON.parse(readFileSync(join(root, 'fixtures', 'classify-fixtures.json'), 'utf8')),
).cases;

export const fixtureText = (id: string): string => {
  const found = fixtureCases.find((c) => c.id === id);
  if (found === undefined) {
    throw new Error(`fixture case ${id} not found`);
  }
  return found.text;
};

export const seeds = SeedCreative.array().parse(
  JSON.parse(readFileSync(join(root, 'examples', 'creatives.seed.json'), 'utf8')),
);

/** Fixture texts by the reason they produce under the default policy with rules only. */
export const TEXT = {
  serve: fixtureText('c001'),
  health: fixtureText('s001'),
  lowIntent: fixtureText('l011'),
  lowConfidence: fixtureText('l014'),
} as const;

export type EvaluateRequestInput = z.input<typeof EvaluateRequest>;

export const evaluateBody = (
  appId: string,
  patch: Partial<EvaluateRequestInput> & { content?: string } = {},
): EvaluateRequestInput => {
  const { content, ...rest } = patch;
  return {
    app_id: appId,
    conversation_id: 'conv_1',
    turn_id: 'turn_1',
    user: { tier: 'free', region: 'US', locale: 'en-US' },
    messages: [{ role: 'user', content: content ?? TEXT.serve }],
    surface: { type: 'chat', placement: 'after_answer', max_creatives: 1 },
    ...rest,
  };
};

export interface HarnessOptions {
  policyYaml?: string | undefined;
  /** Load examples/creatives.seed.json into the global catalog. Default true. */
  seed?: boolean | undefined;
  overrides?: EvaluateDepsOverrides | undefined;
  logLevel?: LogLevel | undefined;
  /** Pool options for the harness handle (default max 4 and the client's timeout defaults). */
  db?: DbOptions | undefined;
  /** Bucket of the Postgres limiter on the write routes. Default: one no test trips by accident. */
  rateLimit?: TokenBucketOptions | undefined;
  /** A limiter of your own (say, a failing one) instead of the Postgres one. */
  rateLimiter?: RateLimiter | undefined;
  /** METRICS_TOKEN for this app. Default: none, so GET /metrics is not mounted (404). */
  metricsToken?: string | undefined;
}

export interface PostOptions {
  /** The bearer to send; null sends no Authorization header. Default: the app's key. */
  apiKey?: string | null | undefined;
  /** A raw body string instead of JSON.stringify(body). */
  raw?: string | undefined;
}

export interface Harness {
  handle: DbHandle;
  app: App;
  config: GatewayConfig;
  keys: GatewaySigningKeys;
  deps: EvaluateDeps;
  registered: RegisteredApp;
  appId: string;
  apiKey: string;
  lines: string[];
  post(body: unknown, options?: PostOptions): Promise<Response>;
  /** POST and parse the body as EvaluateResponse, asserting HTTP 200. */
  evaluate(body: unknown): Promise<EvaluateResponse>;
  /** Empties every per-evaluation table and the in-memory caches; keeps the app and catalog. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

const PER_EVALUATION_TABLES = [
  'audit_records',
  'events',
  'raw_text',
  'cap_state',
  'user_day_caps',
  'classify_cache',
  'rate_limits',
];
const DEFAULT_TEST_RATE_LIMIT: TokenBucketOptions = { rps: 10_000, burst: 10_000 };

export const createHarness = async (options: HarnessOptions = {}): Promise<Harness> => {
  const url = requireTestDatabaseUrl();
  await runMigrations(url);
  const handle = createDb(url, { max: 4, ...options.db });
  await truncateAllTables(handle.sql);

  const registered = await registerApp(handle.db, {
    name: 'Evaluate Test App',
    policyYaml: options.policyYaml,
  });
  if (options.seed !== false) {
    await seedCreatives(handle.db, seeds);
  }

  const config = loadConfig({
    DATABASE_URL: url,
    ADGATE_SIGNING_KEY_ID: KEY_ID,
    ADGATE_SIGNING_KEY_PEM: pair.private_pem,
    PUBLIC_BASE_URL: PUBLIC_BASE_URL,
  });
  const keys = loadSigningKeys(config.signing);
  const deps = createEvaluateDeps(config, handle.db, {
    signing: keys.signing,
    ring: keys.ring,
    ...options.overrides,
  });
  const logs = collectLogs();
  const app = createApp({
    logger: createLogger({ level: options.logLevel ?? 'info' }, logs.stream),
    corsAllowedOrigins: [],
    db: handle.db,
    evaluate: deps,
    rateLimiter:
      options.rateLimiter ??
      createPgRateLimiter(handle.db, options.rateLimit ?? DEFAULT_TEST_RATE_LIMIT),
    ...(options.metricsToken === undefined ? {} : { metricsToken: options.metricsToken }),
  });

  const post: Harness['post'] = async (body, postOptions = {}) => {
    const apiKey = postOptions.apiKey === undefined ? registered.key.api_key : postOptions.apiKey;
    return app.request('/v1/evaluate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey === null ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      body: postOptions.raw ?? JSON.stringify(body),
    });
  };

  return {
    handle,
    app,
    config,
    keys,
    deps,
    registered,
    appId: registered.app.id,
    apiKey: registered.key.api_key,
    lines: logs.lines,
    post,
    evaluate: async (body) => {
      const res = await post(body);
      expect(res.status).toBe(200);
      return EvaluateResponse.parse(await res.json());
    },
    reset: async () => {
      const list = PER_EVALUATION_TABLES.map((name) => `"${name}"`).join(', ');
      await handle.sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
      deps.classifyCache.clear();
      deps.policies.clear();
      // The no_fill deliverability warning fires once per (app, reason) per warner, so a test
      // that wants to see it again must start from a clean one.
      deps.catalogWarnings.clear();
      logs.lines.length = 0;
    },
    close: () => handle.close(),
  };
};

/** Creates a harness for `fn` and closes it afterwards whatever happens. */
export const withHarness = async <T>(
  options: HarnessOptions,
  fn: (harness: Harness) => Promise<T>,
): Promise<T> => {
  const harness = await createHarness(options);
  try {
    return await fn(harness);
  } finally {
    await harness.close();
  }
};

export type AuditRow = typeof auditRecords.$inferSelect;

export const auditRow = async (handle: DbHandle, auditId: string): Promise<AuditRow> => {
  const [row] = await handle.db.select().from(auditRecords).where(eq(auditRecords.id, auditId));
  if (row === undefined) {
    throw new Error(`no audit_records row for ${auditId}`);
  }
  return row;
};

export const auditRowsInOrder = (handle: DbHandle, appId: string): Promise<AuditRow[]> =>
  handle.db
    .select()
    .from(auditRecords)
    .where(eq(auditRecords.appId, appId))
    .orderBy(asc(auditRecords.seq));

/** creativeContentHash over the stored creatives row joined with its advertiser. */
export const storedCreativeHash = async (
  handle: DbHandle,
  creativeId: string,
): Promise<string | null> => {
  const [row] = await handle.db
    .select({ creative: creatives, advertiser: advertisers })
    .from(creatives)
    .innerJoin(advertisers, eq(creatives.advertiserId, advertisers.id))
    .where(eq(creatives.id, creativeId));
  if (row === undefined) {
    return null;
  }
  return creativeContentHash({
    advertiser: row.advertiser.name,
    advertiser_domain: row.advertiser.domain,
    headline: row.creative.headline,
    body: row.creative.body,
    cta: row.creative.cta,
    url_template: row.creative.urlTemplate,
  });
};

/** verify() of a stored row with the harness ring; the caller supplies the chain context. */
export const verifyRow = (harness: Harness, row: AuditRow, ctx: VerifyContext): VerifyResponse =>
  verify(row.record, harness.keys.ring, ctx);

/** Asserts every check passed except the named ones (which must fail). */
export const expectChecks = (result: VerifyResponse, failing: readonly string[] = []): void => {
  for (const check of result.checks) {
    expect(check.ok, `${check.name}: ${check.detail ?? ''}`).toBe(!failing.includes(check.name));
  }
  expect(result.valid).toBe(failing.length === 0);
};

// tablesContaining moved to test-support/table-scan.ts, next to the column-level scan the
// privacy test uses; re-exported here so its callers keep one import.
export { columnsContaining, tablesContaining } from '../test-support/table-scan.js';
