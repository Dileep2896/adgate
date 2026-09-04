import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The core entry must run unchanged in Node 20 and in browsers: no node built-ins, no runtime
 * dependency at all. @adgate/schemas is allowed for TYPES ONLY (`import type` / `export type`),
 * so zod never reaches the bundle (build.test.ts checks the output; this test checks the source).
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

const isImplementation = (name: string) =>
  name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts';
const files = readdirSync(srcDir).filter(isImplementation).sort();
const sourceOf = (name: string) => readFileSync(join(srcDir, name), 'utf8');
const specifiersOf = (source: string) =>
  [...source.matchAll(SPECIFIER)].map((match) => match[1] ?? '');

describe('@adgate/sdk core entry purity', () => {
  it('has the expected implementation files', () => {
    expect(files.map((file) => basename(file))).toEqual([
      'client.ts',
      'generation.ts',
      'guards.ts',
      'hash.ts',
      'http.ts',
      'index.ts',
      'stream.ts',
      'types.ts',
    ]);
  });

  it('imports only relative modules and @adgate/schemas', () => {
    for (const file of files) {
      for (const specifier of specifiersOf(sourceOf(file))) {
        expect(
          specifier.startsWith('./') || specifier === '@adgate/schemas',
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });

  it('never imports a node built-in, zod, or the platform-specific packages', () => {
    for (const file of files) {
      const source = sourceOf(file);
      expect(source, `${file} imports a node built-in`).not.toMatch(/['"]node:/);
      expect(source, `${file} imports zod`).not.toMatch(/['"]zod['"/]/);
      expect(source, `${file} reads the environment`).not.toMatch(/process\.env/);
      expect(source, `${file} logs to the console`).not.toMatch(/console\./);
    }
  });

  it('uses @adgate/schemas for types only', () => {
    // Whole statements, so a multi-line `import type {\n...\n} from` counts as one.
    const STATEMENT = /\b(import|export)\b([^;]*?)from\s+['"]@adgate\/schemas['"]/g;
    for (const file of files) {
      const statements = [...sourceOf(file).matchAll(STATEMENT)];
      for (const statement of statements) {
        expect(
          statement[2]?.trimStart().startsWith('type '),
          `${file}: runtime import: ${statement[0]}`,
        ).toBe(true);
      }
    }
    expect(files.some((file) => STATEMENT.test(sourceOf(file)))).toBe(true);
  });

  it('calls the injected fetch as a plain function (browsers reject a rebound fetch)', () => {
    for (const file of files) {
      expect(sourceOf(file), `${file} calls fetch as a method`).not.toMatch(/\.\s*fetch\s*\(/);
    }
  });

  it('keeps every file under 300 lines (CLAUDE.md)', () => {
    for (const file of readdirSync(srcDir)) {
      const lines = sourceOf(file).split('\n').length;
      expect(lines, `${file} has ${lines} lines`).toBeLessThanOrEqual(300);
    }
  });
});
