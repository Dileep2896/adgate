import { defineConfig } from 'tsup';

/**
 * Two entries, built from one config so the output names are stable: the framework-agnostic
 * core (dist/index.*) and the React components (dist/react.*), which the exports map points
 * "./react" at. react and react-dom stay external: the component is a peer of the host app's
 * React, and the core entry must never pull React in (build.test.ts asserts both).
 */
export default defineConfig({
  entry: { index: 'src/index.ts', react: 'src/react/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['@adgate/schemas', 'react', 'react-dom'],
});
