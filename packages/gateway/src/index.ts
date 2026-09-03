/**
 * @adgate/gateway: the Hono service wiring @adgate/core to Postgres and HTTP. server.ts is the
 * process entry point; this index exposes the building blocks for tests and tooling. The
 * command line scripts (keygen.ts, db/migrate.ts, scripts/*.ts) are deliberately not re-exported: each
 * decides whether it is the main module from its own import.meta.url.
 */
export * from './app.js';
export * from './app-env.js';
export * from './apps/register-app.js';
export * from './auth/keys.js';
export * from './auth/middleware.js';
export * from './auth/repository.js';
export * from './catalog/seed.js';
export * from './config.js';
export * from './db/client.js';
export * from './db/schema.js';
export * from './env-file.js';
export * from './logger.js';
export * from './request-id.js';
export * from './signing.js';
