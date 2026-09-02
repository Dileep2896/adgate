import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md: pure logic lives in packages/core with no HTTP, DB, env or network access. This
 * greps the policy directory's import statements (implementation files only) so a stray
 * import of the gateway or an I/O library fails the build.
 */
const policyDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(policyDir, '..');
const SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const BANNED =
  /^(node:|fs|path|os|http|https|net|tls|dns|child_process|worker_threads|pg|postgres|drizzle|hono|undici|redis|ioredis|@adgate\/gateway|@adgate\/sdk)/;

const isImplementation = (name: string) =>
  name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.fixture.ts');
const specifiersOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].map((match) => match[1] ?? '');
const resolveRelative = (from: string, specifier: string) =>
  resolve(dirname(from), specifier.replace(/\.js$/, '.ts'));

/** Bare specifiers reachable from `file` through relative imports, without leaving src/. */
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

describe('policy package purity', () => {
  it('imports nothing from the gateway, node built-ins or any I/O library', () => {
    const files = readdirSync(policyDir).filter(isImplementation);
    expect(files).toContain('evaluate.ts');
    for (const name of files) {
      for (const specifier of specifiersOf(join(policyDir, name))) {
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(BANNED);
        expect(
          specifier === '@adgate/schemas' || specifier.startsWith('.'),
          `${name} imports ${specifier}`,
        ).toBe(true);
      }
      const source = readFileSync(join(policyDir, name), 'utf8');
      expect(source, `${name} reads the environment`).not.toMatch(/process\.env|fetch\(/);
    }
  });

  it('the engine reaches only @adgate/schemas through its whole import graph', () => {
    expect([...reachableBareImports(join(policyDir, 'evaluate.ts'))]).toEqual(['@adgate/schemas']);
  });
});
