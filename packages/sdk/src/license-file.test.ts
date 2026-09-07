import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The published tarball has to carry the licence, and FSL-1.1-Apache-2.0 has no SPDX identifier,
 * so `license` is npm's documented pointer form instead of an expression. packages/sdk/LICENSE.md
 * is a copy of the repository root LICENSE.md (npm can only pack files inside the package
 * directory); this test is what keeps the copy from drifting.
 */
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '..', '..');
const read = (path: string) => readFileSync(path, 'utf8');

describe('@adgateio/sdk licence', () => {
  const manifest = JSON.parse(read(resolve(packageDir, 'package.json'))) as {
    license: string;
    files: string[];
  };

  it('declares the licence by file, because FSL has no SPDX identifier', () => {
    expect(manifest.license).toBe('SEE LICENSE IN LICENSE.md');
  });

  it('packs LICENSE.md', () => {
    expect(manifest.files).toContain('LICENSE.md');
  });

  it('ships the repository licence byte for byte', () => {
    expect(read(resolve(packageDir, 'LICENSE.md'))).toBe(read(resolve(repoRoot, 'LICENSE.md')));
  });

  it('is the Functional Source License with an Apache 2.0 future licence', () => {
    const text = read(resolve(packageDir, 'LICENSE.md'));
    expect(text).toContain('Functional Source License, Version 1.1');
    expect(text).toContain('Grant of Future License');
    expect(text).toContain('Apache License, Version 2.0');
  });
});
