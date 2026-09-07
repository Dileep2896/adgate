import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@adgateio/core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
