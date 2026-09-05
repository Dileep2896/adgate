import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The same `@/` alias tsconfig.json and Next use.
  resolve: { alias: { '@': here } },
  // The chart tests are .tsx; esbuild needs to be told which JSX runtime to use, since
  // tsconfig.json says "preserve" (Next compiles the app itself).
  esbuild: { jsx: 'automatic' },
  test: {
    name: '@adgate/dashboard',
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // Unit tests, the chart component tests (jsdom, opted into per file with a docblock) and
    // lib/metrics-queries.integration.test.ts, which needs the docker Postgres. The Playwright
    // specs under e2e/ need a browser and run through
    // `pnpm --filter @adgate/dashboard test:e2e`, never through `pnpm test`.
    include: ['lib/**/*.test.ts', 'components/**/*.test.tsx'],
    // The integration test owns its own database, but it still seeds ten thousand rows: keep
    // the files one at a time so a laptop is not running four Postgres connections at once.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
