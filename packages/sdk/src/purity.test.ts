import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The core entry must run unchanged in Node 20 and in browsers: no node built-ins, no runtime
 * dependency at all. @adgateio/schemas is allowed for TYPES ONLY (`import type` / `export type`),
 * so zod never reaches the bundle (build.test.ts checks the output; this test checks the source).
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const reactDir = join(srcDir, 'react');
const aiDir = join(srcDir, 'ai');
const SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

const isImplementation = (name: string) =>
  /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.startsWith('test-support.');
const filesIn = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
const files = filesIn(srcDir).filter(isImplementation);
/** The React (S24) and AI (S25) entries are separate bundles; these rules are about the CORE. */
const reactFiles = filesIn(reactDir).filter(isImplementation);
const aiFiles = filesIn(aiDir).filter(isImplementation);
const sourceOf = (name: string) => readFileSync(join(srcDir, name), 'utf8');
const reactSourceOf = (name: string) => readFileSync(join(reactDir, name), 'utf8');
const aiSourceOf = (name: string) => readFileSync(join(aiDir, name), 'utf8');
const specifiersOf = (source: string) =>
  [...source.matchAll(SPECIFIER)].map((match) => match[1] ?? '');

describe('@adgateio/sdk core entry purity', () => {
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

  it('imports only relative modules and @adgateio/schemas', () => {
    for (const file of files) {
      for (const specifier of specifiersOf(sourceOf(file))) {
        expect(
          specifier.startsWith('./') || specifier === '@adgateio/schemas',
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

  it('uses @adgateio/schemas for types only', () => {
    // Whole statements, so a multi-line `import type {\n...\n} from` counts as one.
    const STATEMENT = /\b(import|export)\b([^;]*?)from\s+['"]@adgateio\/schemas['"]/g;
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

  it('never imports react or the AI SDK: those entries are separate bundles', () => {
    for (const file of files) {
      expect(sourceOf(file), `${file} imports react`).not.toMatch(
        /['"]react(-dom)?(\/[^'"]*)?['"]/,
      );
      expect(sourceOf(file), `${file} imports ai`).not.toMatch(/['"]ai(\/[^'"]*)?['"]/);
    }
  });

  it('keeps every file under 300 lines (CLAUDE.md)', () => {
    for (const [dir, names] of [
      [srcDir, filesIn(srcDir)],
      [reactDir, filesIn(reactDir)],
      [aiDir, filesIn(aiDir)],
    ] as const) {
      for (const file of names) {
        const lines = readFileSync(join(dir, file), 'utf8').split('\n').length;
        expect(lines, `${file} has ${lines} lines`).toBeLessThanOrEqual(300);
      }
    }
  });
});

/**
 * The React entry may use React and the DOM, but nothing else: no Next.js, no CSS-in-JS, no
 * router, no HTTP of its own. It talks to the gateway only through the client it is handed.
 */
describe('@adgateio/sdk react entry', () => {
  it('has the expected implementation files', () => {
    expect(reactFiles).toEqual([
      'index.ts',
      'message-boundary.tsx',
      'separation.ts',
      'sponsored-slot.tsx',
      'use-impression.ts',
    ]);
  });

  it('imports only react, relative modules and @adgateio/schemas types', () => {
    const allowed = new Set(['react', '@adgateio/schemas']);
    for (const file of reactFiles) {
      for (const specifier of specifiersOf(reactSourceOf(file))) {
        expect(
          specifier.startsWith('./') || specifier.startsWith('../') || allowed.has(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
      expect(reactSourceOf(file), `${file} imports next`).not.toMatch(/['"]next(\/[^'"]*)?['"]/);
      expect(reactSourceOf(file), `${file} imports a node built-in`).not.toMatch(/['"]node:/);
      expect(reactSourceOf(file), `${file} reads the environment`).not.toMatch(/process\.env/);
    }
  });

  it('touches window and document only from inside an effect', () => {
    // The one allowed exception is the module-level `typeof document === 'undefined'` probe
    // that picks useEffect over useLayoutEffect on the server; it reads no property.
    const source = reactSourceOf('sponsored-slot.tsx');
    expect(source).toMatch(/typeof document === 'undefined'/);
    expect(source, 'window is never touched').not.toMatch(/\bwindow\b/);
    expect(source, 'document is only probed').not.toMatch(/document\./);
    expect(reactSourceOf('use-impression.ts'), 'window is never touched').not.toMatch(/\bwindow\b/);
    expect(reactSourceOf('use-impression.ts'), 'document is never touched').not.toMatch(
      /\bdocument\b/,
    );
  });
});

/**
 * The AI entry may use the `ai` package for TYPES ONLY (it is an optional peer dependency, so a
 * runtime import would crash an app that never installed it) plus the core client's helpers.
 * No React, no node built-ins, no HTTP of its own.
 */
describe('@adgateio/sdk ai entry', () => {
  it('has the expected implementation files', () => {
    expect(aiFiles).toEqual([
      'ai-types.ts',
      'index.ts',
      'messages.ts',
      'middleware.ts',
      'stream-decorator.ts',
      'turn.ts',
    ]);
  });

  it('imports only the ai types, relative modules and @adgateio/schemas types', () => {
    const allowed = new Set(['ai', '@adgateio/schemas']);
    for (const file of aiFiles) {
      for (const specifier of specifiersOf(aiSourceOf(file))) {
        expect(
          specifier.startsWith('./') || specifier.startsWith('../') || allowed.has(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
      expect(aiSourceOf(file), `${file} imports react`).not.toMatch(/['"]react(-dom)?['"]/);
      expect(aiSourceOf(file), `${file} imports a node built-in`).not.toMatch(/['"]node:/);
      expect(aiSourceOf(file), `${file} reads the environment`).not.toMatch(/process\.env/);
      expect(aiSourceOf(file), `${file} logs to the console`).not.toMatch(/console\./);
    }
  });

  it('uses the ai package for types only, so it never loads at runtime', () => {
    const STATEMENT = /\b(import|export)\b([^;]*?)from\s+['"]ai['"]/g;
    const statements = aiFiles.flatMap((file) => [...aiSourceOf(file).matchAll(STATEMENT)]);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement[2]?.trimStart().startsWith('type '), `runtime import: ${statement[0]}`).toBe(
        true,
      );
    }
  });
});
