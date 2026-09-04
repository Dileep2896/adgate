import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The dashboard is linted by the repo-root ESLint flat config (`pnpm --filter @adgate/dashboard
 * lint`), so `next build` does not run its own lint pass and the app needs no eslint-config-next.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // The dashboard lives in a pnpm workspace; without this Next guesses the tracing root from
  // whichever lockfile it finds first and prints a warning on every start.
  outputFileTracingRoot: resolve(here, '..', '..'),
  // The Postgres driver and Drizzle are plain Node libraries: keep them out of the server
  // bundle so postgres.js keeps its own dynamic requires and connection handling.
  serverExternalPackages: ['postgres', 'drizzle-orm'],
};

export default nextConfig;
