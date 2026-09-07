import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'tsup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Builds the package exactly as `pnpm --filter @adgateio/sdk build` does (both entries, the same
 * flags as tsup.config.ts), into a temp dir, and checks the acceptance criteria on the
 * artefacts: every format plus types exists, the core entry gzips under 15 kB and carries no
 * node built-in, zod, react or @adgateio/schemas runtime import, and the React entry is a
 * separate file that leaves react to the host app.
 *
 * The build goes into packages/sdk/node_modules/.adgate-build-*: a directory OUTSIDE the package
 * would not resolve `react` when the built React entry is imported here, and node_modules is
 * already ignored by git, eslint and vitest.
 */
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_GZIP_BYTES = 15 * 1024;

let outDir = '';
const read = (name: string) => readFileSync(join(outDir, name), 'utf8');

beforeAll(async () => {
  outDir = mkdtempSync(join(packageDir, 'node_modules', '.adgate-build-'));
  await build({
    entry: {
      index: join(packageDir, 'src/index.ts'),
      react: join(packageDir, 'src/react/index.ts'),
      ai: join(packageDir, 'src/ai/index.ts'),
    },
    outDir,
    format: ['esm', 'cjs'],
    splitting: false,
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    tsconfig: join(packageDir, 'tsconfig.json'),
    external: ['@adgateio/schemas', 'react', 'react-dom', 'ai'],
    silent: true,
    config: false,
  });
});

afterAll(() => {
  if (outDir !== '') {
    rmSync(outDir, { recursive: true, force: true });
  }
});

describe('@adgateio/sdk build', () => {
  it('emits ESM, CJS and type declarations for both', () => {
    for (const name of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts']) {
      expect(existsSync(join(outDir, name)), `${name} missing`).toBe(true);
    }
    expect(existsSync(join(outDir, 'index.js.map'))).toBe(true);
    expect(existsSync(join(outDir, 'index.cjs.map'))).toBe(true);
  });

  it('keeps the core entry under 15 kB gzipped', () => {
    const esm = gzipSync(read('index.js')).byteLength;
    const cjs = gzipSync(read('index.cjs')).byteLength;
    expect(esm, `ESM entry is ${esm} bytes gzipped`).toBeLessThan(MAX_GZIP_BYTES);
    expect(cjs, `CJS entry is ${cjs} bytes gzipped`).toBeLessThan(MAX_GZIP_BYTES);
  });

  it('pulls no zod, no node built-in, no react, no ai and no runtime @adgateio/schemas into either output', () => {
    for (const name of ['index.js', 'index.cjs']) {
      const source = read(name);
      expect(source, `${name} imports react`).not.toMatch(/['"]react/);
      expect(source, `${name} imports the ai package`).not.toMatch(/['"]ai(\/[^'"]*)?['"]/);
      // Quoted specifiers only: esbuild's own trailer comment on the CJS output mentions "node:".
      expect(source, `${name} contains zod`).not.toMatch(/['"]zod['"/]/);
      expect(source, `${name} contains a node built-in`).not.toMatch(/['"]node:/);
      expect(source, `${name} imports @adgateio/schemas at runtime`).not.toMatch(
        /['"]@adgateio\/schemas/,
      );
      expect(source, `${name} requires something`).not.toMatch(/\brequire\(/);
      expect(source, `${name} imports something`).not.toMatch(/\bfrom\s+['"]/);
    }
  });

  it('references @adgateio/schemas from the declarations only, and never re-exports its values', () => {
    for (const name of ['index.d.ts', 'index.d.cts']) {
      const declarations = read(name);
      expect(declarations).toMatch(/from '@adgateio\/schemas'/);
      expect(declarations).toMatch(/createClient/);
      expect(declarations, `${name} imports zod`).not.toMatch(/['"]zod['"/]/);
      // The bundler drops `type` on re-exports; a bare `export { X } from '@adgateio/schemas'`
      // would promise the zod schema values at runtime. types.ts uses aliases instead.
      expect(declarations, `${name} re-exports schema values`).not.toMatch(
        /^export \{[^}]*\} from '@adgateio\/schemas'/m,
      );
    }
  });

  it('loads as ESM and as CJS and exposes the same surface', async () => {
    const esm = (await import(pathToFileURL(join(outDir, 'index.js')).href)) as Record<
      string,
      unknown
    >;
    const cjs = createRequire(import.meta.url)(join(outDir, 'index.cjs')) as Record<
      string,
      unknown
    >;
    expect(typeof esm['createClient']).toBe('function');
    expect(typeof cjs['createClient']).toBe('function');
    expect(Object.keys(cjs).sort()).toEqual(Object.keys(esm).sort());
    const client = (esm['createClient'] as (o: unknown) => Record<string, unknown>)({
      apiKey: 'ak_x_y',
      baseUrl: 'https://gateway.example.test',
      fetch: () => Promise.reject(new Error('offline')),
    });
    const result = (await (client['evaluate'] as (r: unknown) => Promise<unknown>)({})) as Record<
      string,
      unknown
    >;
    expect(result['decision']).toBe('suppress');
    expect(result['reason']).toBe('error');
    expect(result['error']).toEqual({ kind: 'network' });
  });
});

describe('@adgateio/sdk/react build', () => {
  it('emits dist/react.js, react.cjs and declarations for both', () => {
    for (const name of ['react.js', 'react.cjs', 'react.d.ts', 'react.d.cts']) {
      expect(existsSync(join(outDir, name)), `${name} missing`).toBe(true);
    }
    expect(existsSync(join(outDir, 'react.js.map'))).toBe(true);
    expect(existsSync(join(outDir, 'react.cjs.map'))).toBe(true);
  });

  it('leaves react to the host app instead of bundling a copy', () => {
    for (const name of ['react.js', 'react.cjs']) {
      const source = read(name);
      expect(source, `${name} does not import react`).toMatch(/['"]react\/jsx-runtime['"]/);
      // A bundled React would drag its internals (and a second renderer) into the app.
      expect(source, `${name} bundles react`).not.toMatch(/react\.(production|development)/);
      expect(source, `${name} imports react-dom`).not.toMatch(/['"]react-dom/);
    }
  });

  it('ships the disclosure contract in the bundle', () => {
    const source = read('react.js');
    expect(source).toContain('Sponsored content');
    expect(source).toContain('sponsored noopener noreferrer');
    expect(source).toContain('Dismiss sponsored content');
    expect(source).toContain('data-adgate-message');
    expect(source).toContain('="assistant"');
  });

  it('declares the component in both declaration flavours', () => {
    for (const name of ['react.d.ts', 'react.d.cts']) {
      const declarations = read(name);
      expect(declarations, `${name} declares SponsoredSlot`).toMatch(/declare const SponsoredSlot/);
      expect(declarations, `${name} declares the props`).toMatch(/SponsoredSlotProps/);
      expect(declarations, `${name} imports zod`).not.toMatch(/['"]zod['"/]/);
    }
  });

  it('loads as ESM with react resolvable, the way a host app imports it', async () => {
    const entry = (await import(pathToFileURL(join(outDir, 'react.js')).href)) as Record<
      string,
      unknown
    >;

    expect(typeof entry['SponsoredSlot']).toBe('function');
    expect(typeof entry['AdgateMessageBoundary']).toBe('function');
    expect(typeof entry['useImpression']).toBe('function');
    expect(entry['SPONSORED_ARIA_LABEL']).toBe('Sponsored content');
  });

  it('is reachable through the package exports map', () => {
    const manifest = readManifest();
    expect(manifest.exports['./react']).toEqual({
      import: { types: './dist/react.d.ts', default: './dist/react.js' },
      require: { types: './dist/react.d.cts', default: './dist/react.cjs' },
      default: './dist/react.js',
    });
    expect(manifest.peerDependencies['react']).toBe('>=18');
  });
});

type Manifest = {
  exports: Record<
    string,
    { import: { types: string; default: string }; require: unknown; default: string }
  >;
  typesVersions: Record<string, Record<string, string[]>>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

const readManifest = (): Manifest =>
  JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Manifest;

describe('@adgateio/sdk/ai build', () => {
  it('emits dist/ai.js, ai.cjs and declarations for both', () => {
    for (const name of ['ai.js', 'ai.cjs', 'ai.d.ts', 'ai.d.cts']) {
      expect(existsSync(join(outDir, name)), `${name} missing`).toBe(true);
    }
    expect(existsSync(join(outDir, 'ai.js.map'))).toBe(true);
    expect(existsSync(join(outDir, 'ai.cjs.map'))).toBe(true);
  });

  it('never loads the ai package at runtime: it is an optional peer used for types only', () => {
    for (const name of ['ai.js', 'ai.cjs']) {
      const source = read(name);
      expect(source, `${name} imports ai`).not.toMatch(/from\s*['"]ai['"]/);
      expect(source, `${name} requires ai`).not.toMatch(/require\(['"]ai['"]\)/);
      expect(source, `${name} imports react`).not.toMatch(/['"]react/);
      expect(source, `${name} contains zod`).not.toMatch(/['"]zod['"/]/);
      expect(source, `${name} contains a node built-in`).not.toMatch(/['"]node:/);
    }
    // The declarations do reference `ai`: that is where the middleware type comes from.
    expect(read('ai.d.ts')).toMatch(/['"]ai['"]/);
  });

  it('ships the middleware and its metadata key', () => {
    expect(read('ai.js')).toContain('adgate');
    for (const name of ['ai.d.ts', 'ai.d.cts']) {
      const declarations = read(name);
      expect(declarations, `${name} declares adgateMiddleware`).toMatch(
        /declare const adgateMiddleware/,
      );
      expect(declarations, `${name} declares the options`).toMatch(/AdgateMiddlewareOptions/);
    }
  });

  it('loads as ESM and as CJS without the ai package being present at runtime', async () => {
    const esm = (await import(pathToFileURL(join(outDir, 'ai.js')).href)) as Record<
      string,
      unknown
    >;
    const cjs = createRequire(import.meta.url)(join(outDir, 'ai.cjs')) as Record<string, unknown>;
    expect(typeof esm['adgateMiddleware']).toBe('function');
    expect(esm['ADGATE_METADATA_KEY']).toBe('adgate');
    expect(Object.keys(cjs).sort()).toEqual(Object.keys(esm).sort());
  });

  it('is reachable through the package exports map and declares ai as an optional peer', () => {
    const manifest = readManifest();
    expect(manifest.exports['./ai']).toEqual({
      import: { types: './dist/ai.d.ts', default: './dist/ai.js' },
      require: { types: './dist/ai.d.cts', default: './dist/ai.cjs' },
      default: './dist/ai.js',
    });
    // The middleware targets provider spec v4, which is what ai 7 ships: a wider range would
    // promise majors nothing here has ever been built or tested against.
    expect(manifest.peerDependencies['ai']).toBe('^7');
    expect(manifest.peerDependenciesMeta['ai']).toEqual({ optional: true });
  });
});

describe('@adgateio/sdk resolution for older tooling', () => {
  it('gives every exports entry a default condition, and every target exists', () => {
    const manifest = readManifest();
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      expect(typeof entry.default, `${subpath} has no default condition`).toBe('string');
      for (const target of [entry.default, entry.import.default, entry.import.types]) {
        expect(existsSync(join(outDir, target.replace('./dist/', ''))), `${target} missing`).toBe(
          true,
        );
      }
    }
  });

  it('maps the subpath types with typesVersions, for a resolver that ignores exports', () => {
    const manifest = readManifest();
    expect(manifest.typesVersions['*']).toEqual({
      react: ['./dist/react.d.ts'],
      ai: ['./dist/ai.d.ts'],
    });
    for (const targets of Object.values(manifest.typesVersions['*'] ?? {})) {
      for (const target of targets) {
        expect(existsSync(join(outDir, target.replace('./dist/', '')))).toBe(true);
      }
    }
  });
});
