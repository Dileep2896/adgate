import { defineConfig } from 'vitest/config';

// Root runner: `pnpm vitest` from the repo root runs every package as a project.
// `pnpm test` goes through turbo and runs each package's own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
