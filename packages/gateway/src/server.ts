import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { ConfigError, configWarnings, type GatewayConfig, loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { loadRootEnvFile } from './env-file.js';
import { createEvaluateDeps } from './evaluate/deps.js';
import { createLogger } from './logger.js';
import { createPgRateLimiter } from './rate-limit/pg.js';
import { startRetentionScheduler } from './retention/scheduler.js';
import { type GatewaySigningKeys, loadSigningKeys } from './signing.js';

/**
 * The process entry point (`pnpm dev`, `pnpm start`): load the repo-root .env when present,
 * validate the configuration and the signing keys (any problem prints a readable message and
 * exits 1 before a port is opened), connect to Postgres, serve the app, and shut down cleanly
 * on SIGINT/SIGTERM.
 */

const SHUTDOWN_GRACE_MS = 5_000;

const boot = (): { config: GatewayConfig; keys: GatewaySigningKeys } => {
  try {
    const config = loadConfig();
    const keys = loadSigningKeys(config.signing);
    return { config, keys };
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
};

const main = (): void => {
  const envFile = loadRootEnvFile();
  const { config, keys } = boot();
  const logger = createLogger({ level: config.logLevel });
  logger.info(
    {
      env_file: envFile,
      node_env: config.nodeEnv,
      key_id: keys.signing.key_id,
      /**
       * The key_id is a label an operator types; the fingerprint is the key. Logging both means
       * a signing key that changed WITHOUT its id changing - a restored backup, a deploy script
       * that re-ran keygen - is one diff apart in two deploy logs, instead of showing up weeks
       * later as records that will not verify. It is a digest of the public half: not a secret.
       */
      key_fingerprint: keys.fingerprint,
      verification_keys: keys.ring.key_ids.length,
      verification_key_ids: keys.ring.key_ids,
      classifier: config.classifier === null ? 'rules_only' : config.classifier.model,
      koah_enabled: config.koah.enabled,
      gravity_enabled: config.gravity.enabled,
      rate_limit: config.rateLimit,
      retention_interval_hours: config.retentionIntervalHours,
      // Never the token itself: only whether GET /metrics exists in this process.
      metrics_enabled: config.metricsToken !== null,
    },
    'configuration loaded',
  );
  for (const warning of configWarnings(config)) {
    logger.warn({}, warning);
  }

  const database = createDb(config.databaseUrl, config.db);
  const app = createApp({
    logger,
    corsAllowedOrigins: config.corsAllowedOrigins,
    db: database.db,
    evaluate: createEvaluateDeps(config, database.db, { signing: keys.signing, ring: keys.ring }),
    rateLimiter: createPgRateLimiter(database.db, config.rateLimit),
    metricsToken: config.metricsToken,
  });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info({ port: info.port, address: info.address }, 'gateway listening');
  });

  /**
   * null unless RETENTION_INTERVAL_HOURS is set: a deployment with cron keeps running
   * `pnpm --filter @adgate/gateway retention` and nothing here changes for it. Every run is
   * guarded by a Postgres advisory lock, so several instances of this process are safe.
   */
  const retention = startRetentionScheduler({
    db: database.db,
    sql: database.sql,
    logger,
    intervalHours: config.retentionIntervalHours,
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutting down');
    // Before anything else: a tick that fires during shutdown would take a lock on a pool that
    // is about to close.
    retention?.stop();
    const deadline = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
    deadline.unref();
    server.close(() => {
      database
        .close()
        .catch((error: unknown) => logger.error({ err: error }, 'database close failed'))
        .finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

main();
