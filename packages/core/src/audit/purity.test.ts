import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md: pure logic lives in packages/core with no HTTP, DB, env or network access. The
 * audit directory may reach @adgate/schemas (the record and key shapes), node:crypto (hashing
 * and Ed25519) and ../canonical (canonical JSON), and nothing else outside src/. Keys are always
 * passed in as PEM strings; nothing here reads the environment. Same approach as
 * ../demand/purity.test.ts.
 */
const auditDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(auditDir, '..');
const SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const BANNED =
  /^(node:(?!crypto$)|fs|path|os|http|https|net|tls|dns|child_process|worker_threads|pg|postgres|drizzle|hono|undici|redis|ioredis|zod|jose|tweetnacl|noble|@adgate\/gateway|@adgate\/sdk)/;

const isImplementation = (name: string) =>
  name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.fixture.ts');
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

describe('audit package purity', () => {
  const files = readdirSync(auditDir).filter(isImplementation).sort();

  it('has the expected implementation files', () => {
    expect(files).toEqual([
      'attest.ts',
      'chain.ts',
      'content-hash.ts',
      'crypto.ts',
      'errors.ts',
      'index.ts',
      'keys.ts',
      'privacy-hash.ts',
      'record.ts',
      'verify-checks.ts',
      'verify-supersedes.ts',
      'verify.ts',
    ]);
  });

  it('imports nothing from the gateway, node built-ins beyond crypto, or any I/O library', () => {
    for (const name of files) {
      for (const specifier of specifiersOf(join(auditDir, name))) {
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(BANNED);
        expect(
          specifier === '@adgate/schemas' ||
            specifier === 'node:crypto' ||
            specifier.startsWith('.'),
          `${name} imports ${specifier}`,
        ).toBe(true);
      }
      const source = readFileSync(join(auditDir, name), 'utf8');
      expect(source, `${name} reads the environment`).not.toMatch(/process\.env/);
      expect(source, `${name} touches the network`).not.toMatch(/globalThis|\bfetch\s*\(/);
    }
  });

  it('reaches only @adgate/schemas and node:crypto through its whole import graph', () => {
    const bare = [...reachableBareImports(join(auditDir, 'index.ts'))].sort();
    expect(bare).toEqual(['@adgate/schemas', 'node:crypto']);
  });

  it('keeps every file under 300 lines (CLAUDE.md)', () => {
    for (const name of readdirSync(auditDir)) {
      const lines = readFileSync(join(auditDir, name), 'utf8').split('\n').length;
      expect(lines, `${name} has ${lines} lines`).toBeLessThanOrEqual(300);
    }
  });
});
