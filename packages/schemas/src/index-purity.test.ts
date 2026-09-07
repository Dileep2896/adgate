import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * @adgateio/schemas is imported by every other package, including the SDK and the dashboard that
 * bundle it for browsers, so nothing reachable from the package index may import a node
 * built-in. The node:fs writer (toJsonSchema) lives in json-schema-files.ts, reached only by
 * the gen-json.ts script and the tests.
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

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
    for (const nested of reachableBareImports(resolveRelative(file, specifier), seen)) {
      bare.add(nested);
    }
  }
  return bare;
};

describe('package index purity', () => {
  it('reaches only zod and yaml through its whole import graph, never a node built-in', () => {
    const bare = [...reachableBareImports(join(srcDir, 'index.ts'))].sort();
    expect(bare).toEqual(['yaml', 'zod']);
  });

  it('keeps node:fs out of index.ts itself', () => {
    expect(readFileSync(join(srcDir, 'index.ts'), 'utf8')).not.toMatch(/node:/);
  });
});
