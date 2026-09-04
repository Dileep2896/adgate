import { defineConfig } from 'tsup';

/**
 * Three entries, built from one config so the output names are stable: the framework-agnostic
 * core (dist/index.*), the React components (dist/react.*) and the Vercel AI SDK middleware
 * (dist/ai.*), which the exports map points "./react" and "./ai" at. react, react-dom and ai
 * stay external: each is a peer of the host app's copy, and the core entry must never pull any
 * of them in (build.test.ts asserts both).
 */
export default defineConfig({
  entry: { index: 'src/index.ts', react: 'src/react/index.ts', ai: 'src/ai/index.ts' },
  format: ['esm', 'cjs'],
  // The AI entry reuses the core client, and esbuild would hoist that shared code into a chunk
  // both entries import. Each entry stays one self-contained file instead: a few kB of duplicated
  // client code is cheaper than a second request, and it keeps the core entry's gzip budget real.
  splitting: false,
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['@adgate/schemas', 'react', 'react-dom', 'ai'],
});
