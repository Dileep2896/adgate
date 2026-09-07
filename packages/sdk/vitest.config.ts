import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The React entry is .tsx; the automatic runtime keeps `import React` out of the components.
  esbuild: { jsx: 'automatic' },
  test: {
    name: '@adgateio/sdk',
    // Node everywhere. The component tests opt into jsdom per file with a
    // `// @vitest-environment jsdom` docblock, so the SSR test still runs where there is no
    // window at all and can prove the component never touches one.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // build.test.ts runs tsup (esbuild plus a DTS bundle) into a temp dir, which takes a few
    // seconds on a cold machine. The unit tests use fake timers, so the longer limit costs nothing.
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
