import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isMainModule } from '../cli.js';
import { findRepoRoot } from '../env-file.js';
import { buildOpenApiDocument } from '../openapi/document.js';
import { renderApiReference } from '../openapi/reference.js';

/**
 * `pnpm docs:api` (root) / `pnpm --filter @adgate/gateway docs:api`: regenerates
 * docs/api-reference.md from the OpenAPI document. Touches no database and no network.
 * The rendering lives in src/openapi/reference.ts; packages/gateway/scripts/api-reference.ts
 * is the entry point pnpm runs, and openapi/reference.test.ts fails when the committed file
 * differs from a fresh render. docs/api.md is the human contract and is never generated.
 */

/** Path of the generated file, relative to the repo root. */
export const API_REFERENCE_FILE = join('docs', 'api-reference.md');

export const apiReferencePath = (): string => {
  const root = findRepoRoot();
  if (root === null) {
    throw new Error(`not inside the repo: cannot locate ${API_REFERENCE_FILE}`);
  }
  return join(root, API_REFERENCE_FILE);
};

/** The reference as it should be on disk right now. No server URL, so it is deterministic. */
export const renderCurrentApiReference = (): string => renderApiReference(buildOpenApiDocument());

export const writeApiReference = (path: string = apiReferencePath()): string => {
  writeFileSync(path, renderCurrentApiReference(), 'utf8');
  return path;
};

export const runApiReferenceCli = (): void => {
  process.stdout.write(`wrote ${writeApiReference()}\n`);
};

if (isMainModule(import.meta.url)) {
  runApiReferenceCli();
}
