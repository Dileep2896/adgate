import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@adgate/core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
