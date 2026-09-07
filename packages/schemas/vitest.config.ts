import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@adgateio/schemas',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
