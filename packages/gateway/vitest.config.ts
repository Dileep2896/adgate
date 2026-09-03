import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@adgate/gateway',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Integration tests share one Postgres test database (DATABASE_URL_TEST) and truncate it
    // between tests, so test files must never run at the same time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
