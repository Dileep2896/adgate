import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The example is linted by the repo-root ESLint flat config (`pnpm --filter nextjs-chat lint`),
 * so `next build` does not run its own lint pass and the app needs no eslint-config-next.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // The example lives in a pnpm workspace; without this Next guesses the tracing root from
  // whichever lockfile it finds first and prints a warning on every start.
  outputFileTracingRoot: resolve(here, '..', '..'),
};

export default nextConfig;
