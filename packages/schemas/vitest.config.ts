import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@adgate/schemas',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
