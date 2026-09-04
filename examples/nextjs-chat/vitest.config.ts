import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The components are .tsx; the automatic runtime keeps `import React` out of them, exactly
  // like Next's own compiler does.
  esbuild: { jsx: 'automatic' },
  // The same `@/` alias tsconfig.json and Next use.
  resolve: { alias: { '@': here } },
  test: {
    name: 'nextjs-chat',
    // Node by default; the component test opts into jsdom with a `@vitest-environment` docblock.
    environment: 'node',
    include: ['{app,components,lib}/**/*.test.ts', '{app,components,lib}/**/*.test.tsx'],
  },
});
