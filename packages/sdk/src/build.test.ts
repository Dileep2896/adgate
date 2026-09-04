import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'tsup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Builds the package exactly as `pnpm --filter @adgate/sdk build` does, into a temp dir, and
 * checks the story's acceptance criteria on the artefacts: both formats plus types exist, the
 * core entry gzips under 15 kB, and no node built-in, zod or @adgate/schemas runtime import
 * survives in the bundle.
 */
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_GZIP_BYTES = 15 * 1024;

let outDir = '';
const read = (name: string) => readFileSync(join(outDir, name), 'utf8');

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'adgate-sdk-build-'));
  await build({
    entry: { index: join(packageDir, 'src/index.ts') },
    outDir,
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    tsconfig: join(packageDir, 'tsconfig.json'),
    external: ['@adgate/schemas'],
    silent: true,
    config: false,
  });
});

afterAll(() => {
  if (outDir !== '') {
    rmSync(outDir, { recursive: true, force: true });
  }
});

describe('@adgate/sdk build', () => {
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

  it('pulls no zod, no node built-in and no runtime @adgate/schemas into either output', () => {
    for (const name of ['index.js', 'index.cjs']) {
      const source = read(name);
      // Quoted specifiers only: esbuild's own trailer comment on the CJS output mentions "node:".
      expect(source, `${name} contains zod`).not.toMatch(/['"]zod['"/]/);
      expect(source, `${name} contains a node built-in`).not.toMatch(/['"]node:/);
      expect(source, `${name} imports @adgate/schemas at runtime`).not.toMatch(
        /['"]@adgate\/schemas/,
      );
      expect(source, `${name} requires something`).not.toMatch(/\brequire\(/);
      expect(source, `${name} imports something`).not.toMatch(/\bfrom\s+['"]/);
    }
  });

  it('references @adgate/schemas from the declarations only, and never re-exports its values', () => {
    for (const name of ['index.d.ts', 'index.d.cts']) {
      const declarations = read(name);
      expect(declarations).toMatch(/from '@adgate\/schemas'/);
      expect(declarations).toMatch(/createClient/);
      expect(declarations, `${name} imports zod`).not.toMatch(/['"]zod['"/]/);
      // The bundler drops `type` on re-exports; a bare `export { X } from '@adgate/schemas'`
      // would promise the zod schema values at runtime. types.ts uses aliases instead.
      expect(declarations, `${name} re-exports schema values`).not.toMatch(
        /^export \{[^}]*\} from '@adgate\/schemas'/m,
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
