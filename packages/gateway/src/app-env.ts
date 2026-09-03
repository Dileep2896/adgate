import type { Logger } from 'pino';

/** Per-request variables the middleware in request-id.ts sets on the Hono context. */
export interface AppVariables {
  requestId: string;
  logger: Logger;
}

/** The Hono environment of every route in this gateway: `new Hono<AppEnv>()`. */
export type AppEnv = { Variables: AppVariables };
