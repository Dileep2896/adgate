import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The same `@/` alias tsconfig.json and Next use.
  resolve: { alias: { '@': here } },
  test: {
    name: '@adgate/dashboard',
    environment: 'node',
    // Unit tests only. The Playwright specs under e2e/ need a browser and a database and run
    // through `pnpm --filter @adgate/dashboard test:e2e`, never through `pnpm test`.
    include: ['lib/**/*.test.ts'],
  },
});
