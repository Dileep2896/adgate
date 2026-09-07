import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md: pure logic lives in packages/core with no HTTP, DB, env or network access. The
 * demand directory (affiliate/ included) may reach @adgateio/schemas and node:crypto (through
 * ../ids/ulid.ts, for creative ids) and nothing else outside src/. Same approach as
 * ../policy/evaluate-purity.test.ts. The affiliate adapter builds links, it never fetches them.
 */
const demandDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(demandDir, '..');
const SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const BANNED =
  /^(node:(?!crypto$)|fs|path|os|http|https|net|tls|dns|child_process|worker_threads|pg|postgres|drizzle|hono|undici|redis|ioredis|zod|@adgateio\/gateway|@adgateio\/sdk)/;

const isImplementation = (name: string) =>
  name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.fixture.ts');
const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
/** Every file under dir, recursively, as sorted paths relative to the demand directory. */
const walk = (dir: string): string[] =>
  listFiles(dir)
    .map((file) => relative(demandDir, file))
    .sort();
const specifiersOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].map((match) => match[1] ?? '');
const resolveRelative = (from: string, specifier: string) =>
  resolve(dirname(from), specifier.replace(/\.js$/, '.ts'));

const reachableBareImports = (file: string, seen = new Set<string>()): Set<string> => {
  const bare = new Set<string>();
  if (seen.has(file)) {
    return bare;
  }
  seen.add(file);
  for (const specifier of specifiersOf(file)) {
    if (!specifier.startsWith('.')) {
      bare.add(specifier);
      continue;
    }
    const target = resolveRelative(file, specifier);
    expect(target.startsWith(srcDir), `${file} imports outside src: ${specifier}`).toBe(true);
    for (const nested of reachableBareImports(target, seen)) {
      bare.add(nested);
    }
  }
  return bare;
};

describe('demand package purity', () => {
  const files = walk(demandDir).filter((file) => isImplementation(basename(file)));

  it('has the expected implementation files', () => {
    expect(files).toEqual([
      'affiliate/adapter.ts',
      'affiliate/amazon.ts',
      'affiliate/impact.ts',
      'affiliate/index.ts',
      'affiliate/partnerstack.ts',
      'affiliate/registry.ts',
      'affiliate/template.ts',
      'affiliate/types.ts',
      'catalog.ts',
      'deliverability.ts',
      'direct.ts',
      'exclusions.ts',
      'gravity.ts',
      'index.ts',
      'keywords.ts',
      'koah.ts',
      'match.ts',
      'mediate.ts',
      'network-stub.ts',
      'regions.ts',
      'response.ts',
      'select.ts',
      'types.ts',
    ]);
  });

  it('imports nothing from the gateway, node built-ins or any I/O library', () => {
    for (const name of files) {
      for (const specifier of specifiersOf(join(demandDir, name))) {
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(BANNED);
        expect(
          specifier === '@adgateio/schemas' || specifier.startsWith('.'),
          `${name} imports ${specifier}`,
        ).toBe(true);
      }
      const source = readFileSync(join(demandDir, name), 'utf8');
      expect(source, `${name} reads the environment`).not.toMatch(/process\.env/);
      expect(source, `${name} touches the network`).not.toMatch(/globalThis\.fetch|\bawait fetch/);
    }
  });

  it('reaches only @adgateio/schemas and node:crypto through its whole import graph', () => {
    const bare = [...reachableBareImports(join(demandDir, 'index.ts'))].sort();
    expect(bare).toEqual(['@adgateio/schemas', 'node:crypto']);
    expect([...reachableBareImports(join(demandDir, 'direct.ts'))]).toEqual(['@adgateio/schemas']);
    expect([...reachableBareImports(join(demandDir, 'affiliate/index.ts'))]).toEqual([
      '@adgateio/schemas',
    ]);
  });

  it('the partner stubs (docs/decisions.md item 10) never spell out a fetch call at all', () => {
    for (const name of ['koah.ts', 'gravity.ts', 'network-stub.ts']) {
      expect([...reachableBareImports(join(demandDir, name))]).toEqual(['@adgateio/schemas']);
    }
    for (const name of ['koah.ts', 'gravity.ts']) {
      const source = readFileSync(join(demandDir, name), 'utf8');
      expect(source, `${name} references fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${name} reaches for a global`).not.toMatch(/globalThis/);
    }
  });

  it('keeps every file under 300 lines (CLAUDE.md)', () => {
    for (const name of walk(demandDir)) {
      const lines = readFileSync(join(demandDir, name), 'utf8').split('\n').length;
      expect(lines, `${name} has ${lines} lines`).toBeLessThanOrEqual(300);
    }
  });
});
