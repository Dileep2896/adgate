import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md: pure logic lives in packages/core with no HTTP, DB, env or network access. The
 * rules classifier may reach node:crypto (through ../canonical/sha256, for RULES_VERSION) and
 * nothing else outside src/. Same approach as policy/evaluate-purity.test.ts.
 */
const rulesDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(rulesDir, '../..');
const SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const BANNED =
  /^(node:(?!crypto$)|fs|path|os|http|https|net|tls|dns|child_process|worker_threads|pg|postgres|drizzle|hono|undici|redis|ioredis|@adgate\/gateway|@adgate\/sdk)/;

const isImplementation = (name: string) =>
  name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.fixture.ts');
const specifiersOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].map((match) => match[1] ?? '');
const resolveRelative = (from: string, specifier: string) =>
  resolve(dirname(from), specifier.replace(/\.js$/, '.ts'));

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });

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

describe('rules classifier purity', () => {
  const files = walk(rulesDir).filter(isImplementation);

  it('has implementation files including the data registry', () => {
    expect(files.some((file) => file.endsWith('/classify.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('/data/index.ts'))).toBe(true);
  });

  it('imports nothing from the gateway, node built-ins or any I/O library', () => {
    for (const file of files) {
      for (const specifier of specifiersOf(file)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(BANNED);
        expect(
          specifier === '@adgate/schemas' || specifier.startsWith('.'),
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} reads the environment`).not.toMatch(/process\.env|fetch\(/);
    }
  });

  it('reaches only @adgate/schemas and node:crypto through its whole import graph', () => {
    const bare = [...reachableBareImports(join(rulesDir, 'classify.ts'))].sort();
    expect(bare).toEqual(['@adgate/schemas', 'node:crypto']);
  });

  it('keeps every file under 300 lines (CLAUDE.md)', () => {
    for (const file of walk(rulesDir)) {
      const lines = readFileSync(file, 'utf8').split('\n').length;
      expect(lines, `${file} has ${lines} lines`).toBeLessThanOrEqual(300);
    }
  });
});
