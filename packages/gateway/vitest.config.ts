import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@adgate/gateway',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
