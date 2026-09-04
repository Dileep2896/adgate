import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * docs/integration.md is a copy-paste guide, so every snippet in it has to compile against the
 * SDK that is in the tree right now (S29 acceptance criterion). This test extracts each ```ts and
 * ```tsx block, writes it to its own file, and type checks the lot with the TypeScript compiler
 * under the repo's own strict settings (tsconfig.base.json plus the DOM lib and the React JSX
 * runtime that packages/sdk/tsconfig.json adds).
 *
 * Level of checking: full type checking, not a syntax pass. Nothing is executed, so a snippet
 * makes no network call. Every snippet must be SELF-CONTAINED - no preamble is added, so the
 * imports in the doc are the imports the block needs.
 *
 * `@adgate/sdk`, `@adgate/sdk/react` and `@adgate/sdk/ai` are mapped with `paths` onto the three
 * entry sources, so the snippets are checked against src and not against a stale dist. The
 * snippet files live in packages/sdk/node_modules/.adgate-docs-* (like build.test.ts) so that
 * `react`, `ai` and `@adgate/schemas` resolve the way they do for the package itself.
 */
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '../..');
const docPath = join(repoRoot, 'docs', 'integration.md');

/** Fenced blocks whose info string is exactly `ts` or `tsx`. */
const FENCE = /^```(ts|tsx)\n([\s\S]*?)^```$/gm;

type Snippet = { index: number; language: 'ts' | 'tsx'; source: string };

const snippetsOf = (markdown: string): Snippet[] =>
  [...markdown.matchAll(FENCE)].map((match, index) => ({
    index,
    language: (match[1] ?? 'ts') as 'ts' | 'tsx',
    source: match[2] ?? '',
  }));

const snippets = snippetsOf(readFileSync(docPath, 'utf8'));

/** @types/node is a root devDependency; the snippets use process and process.stdout. */
const nodeTypesDir = resolve(
  dirname(createRequire(import.meta.url).resolve('@types/node/package.json')),
  '..',
);

const compilerOptions: ts.CompilerOptions = {
  // tsconfig.base.json
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  esModuleInterop: true,
  skipLibCheck: true,
  resolveJsonModule: true,
  isolatedModules: true,
  // packages/sdk/tsconfig.json
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  jsx: ts.JsxEmit.ReactJSX,
  types: ['node'],
  typeRoots: [nodeTypesDir],
  noEmit: true,
  // A published consumer resolves these through the exports map; here they point at the source
  // that map is built from, so the doc can never pass against yesterday's build.
  baseUrl: packageDir,
  paths: {
    '@adgate/sdk': ['src/index.ts'],
    '@adgate/sdk/react': ['src/react/index.ts'],
    '@adgate/sdk/ai': ['src/ai/index.ts'],
  },
};

let dir = '';
let fileNames: string[] = [];

const describeDiagnostic = (diagnostic: ts.Diagnostic): string => {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return `TS${diagnostic.code}: ${message}`;
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const name = diagnostic.file.fileName.replace(`${dir}/`, '').replace(`${repoRoot}/`, '');
  return `${name}:${line + 1}:${character + 1} TS${diagnostic.code}: ${message}`;
};

beforeAll(() => {
  dir = mkdtempSync(join(packageDir, 'node_modules', '.adgate-docs-'));
  fileNames = snippets.map((snippet) => {
    const file = join(dir, `snippet-${String(snippet.index + 1)}.${snippet.language}`);
    writeFileSync(file, snippet.source, 'utf8');
    return file;
  });
});

afterAll(() => {
  if (dir !== '') {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('docs/integration.md', () => {
  it('documents the three integration shapes', () => {
    const markdown = readFileSync(docPath, 'utf8');
    expect(markdown).toContain('## 1. Web chat UI');
    expect(markdown).toContain('## 2. Agent framework loop');
    expect(markdown).toContain('## 3. Coding agent CLI');
    expect(markdown).toContain('## Rules that apply to every shape');
    expect(markdown).toContain('## Verifying what happened');
  });

  it('has a TypeScript and a TSX snippet to check', () => {
    // A regex that stops matching, or a doc that loses its code, must fail rather than pass.
    expect(snippets.length).toBeGreaterThanOrEqual(5);
    expect(snippets.some((snippet) => snippet.language === 'tsx')).toBe(true);
  });

  it('imports the SDK from its public entry points only', () => {
    const SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]/g;
    const allowed = new Set(['@adgate/sdk', '@adgate/sdk/react', '@adgate/sdk/ai', 'ai', 'react']);
    for (const snippet of snippets) {
      for (const match of snippet.source.matchAll(SPECIFIER)) {
        const specifier = match[1] ?? '';
        expect(
          allowed.has(specifier) || specifier.startsWith('node:'),
          `snippet ${String(snippet.index + 1)} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });

  it('type checks every ts and tsx snippet against the SDK sources', () => {
    const program = ts.createProgram(fileNames, compilerOptions);
    const diagnostics = ts.getPreEmitDiagnostics(program).map(describeDiagnostic);
    expect(diagnostics, diagnostics.join('\n')).toEqual([]);
  });
});
