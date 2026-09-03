import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { ConfigError, type GatewayConfig, loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { loadRootEnvFile } from './env-file.js';
import { createLogger } from './logger.js';
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
      verification_key_ids: keys.ring.key_ids,
      classifier: config.classifier === null ? 'rules_only' : config.classifier.model,
      koah_enabled: config.koah.enabled,
      gravity_enabled: config.gravity.enabled,
    },
    'configuration loaded',
  );

  const database = createDb(config.databaseUrl);
  const app = createApp({
    logger,
    corsAllowedOrigins: config.corsAllowedOrigins,
    db: database.db,
  });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info({ port: info.port, address: info.address }, 'gateway listening');
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutting down');
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
