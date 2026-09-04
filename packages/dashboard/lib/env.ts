import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { z } from 'zod';

/**
 * Dashboard configuration: one Zod schema over the environment, read lazily so `next build`
 * needs no database and no password. Server side only (it touches node:fs and process.env);
 * middleware.ts must never import it, because Next runs middleware in the Edge runtime.
 *
 * Every variable is documented in the repo-root .env.example. That file is also where a local
 * `pnpm dev` gets its values from: Next only loads .env files inside packages/dashboard, so
 * loadRepoEnvFile() reads the repo-root .env the gateway already uses. Variables already set
 * in the real environment always win (that is how Node's own --env-file behaves), so a
 * container or CI job that exports them is unaffected.
 */

export const REPO_ROOT_MARKER = 'pnpm-workspace.yaml';

export class DashboardConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DashboardConfigError';
  }
}

/** The closest ancestor of `start` (inclusive) holding `marker`, or null within maxDepth. */
const findUpwards = (start: string, marker: string, maxDepth = 8): string | null => {
  let current = resolve(start);
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (existsSync(join(current, marker))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
};

let repoEnvLoaded = false;

/** Loads the repo-root .env once per process when it exists. Returns the path, or null. */
export const loadRepoEnvFile = (start: string = process.cwd()): string | null => {
  if (repoEnvLoaded) {
    return null;
  }
  repoEnvLoaded = true;
  const root = findUpwards(start, REPO_ROOT_MARKER);
  if (root === null) {
    return null;
  }
  const file = join(root, '.env');
  if (!existsSync(file)) {
    return null;
  }
  process.loadEnvFile(file);
  return file;
};

/** Blank values count as unset, exactly like the gateway's config schema. */
const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const DashboardEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: optionalNonEmpty,
  ADMIN_PASSWORD: optionalNonEmpty,
  DASHBOARD_SESSION_SECRET: optionalNonEmpty,
});

export interface DashboardEnv {
  nodeEnv: 'development' | 'test' | 'production';
  /** The gateway's database. The dashboard only ever SELECTs from it. */
  databaseUrl: string;
  adminPassword: string;
  /** HMAC key for the session cookie. Never leaves the server. */
  sessionSecret: string;
  /** Secure cookies outside development, so the session cookie is https-only in production. */
  secureCookies: boolean;
}

/**
 * Parses the environment. Throws DashboardConfigError naming the missing variables and never
 * their values. DASHBOARD_SESSION_SECRET is optional: without it sessions are signed with a
 * key derived from ADMIN_PASSWORD, so changing the password logs everyone out.
 */
export const loadDashboardEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): DashboardEnv => {
  const parsed = DashboardEnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new DashboardConfigError(`invalid dashboard environment: ${names}`);
  }
  const { NODE_ENV, DATABASE_URL, ADMIN_PASSWORD, DASHBOARD_SESSION_SECRET } = parsed.data;
  const missing = [
    ...(DATABASE_URL === undefined ? ['DATABASE_URL'] : []),
    ...(ADMIN_PASSWORD === undefined ? ['ADMIN_PASSWORD'] : []),
  ];
  if (DATABASE_URL === undefined || ADMIN_PASSWORD === undefined) {
    throw new DashboardConfigError(
      `dashboard is not configured: set ${missing.join(' and ')} (see .env.example)`,
    );
  }
  return {
    nodeEnv: NODE_ENV,
    databaseUrl: DATABASE_URL,
    adminPassword: ADMIN_PASSWORD,
    sessionSecret: DASHBOARD_SESSION_SECRET ?? `adgate-dashboard-session:${ADMIN_PASSWORD}`,
    secureCookies: NODE_ENV === 'production',
  };
};

/** The parsed environment for this process, loading the repo-root .env on first use. */
export const dashboardEnv = (): DashboardEnv => {
  loadRepoEnvFile();
  return loadDashboardEnv();
};
