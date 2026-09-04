import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@adgate/sdk',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // build.test.ts runs tsup (esbuild plus a DTS bundle) into a temp dir, which takes a few
    // seconds on a cold machine. The unit tests use fake timers, so the longer limit costs nothing.
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
