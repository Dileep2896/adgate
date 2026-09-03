import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ContractSchemaName, jsonSchemaFileName, renderJsonSchemas } from './json-schema.js';

/**
 * The node:fs half of the JSON Schema tooling. Deliberately not exported from the package index
 * (index-purity.test.ts): @adgate/schemas is bundled for browsers by the SDK and the dashboard,
 * so nothing reachable from the index may import a node built-in. Used by the gen-json.ts
 * script (`pnpm --filter @adgate/schemas gen:json`) and by json-schema.test.ts.
 */

/** Default output directory: packages/schemas/json (one level above src/ and dist/). */
export const JSON_SCHEMA_DIR = fileURLToPath(new URL('../json/', import.meta.url));

/**
 * Writes `<outDir>/<Name>.schema.json` for every contract schema and returns the paths written.
 * json-schema.test.ts asserts the committed files match renderJsonSchemas() byte for byte.
 */
export const toJsonSchema = (outDir: string = JSON_SCHEMA_DIR): string[] => {
  mkdirSync(outDir, { recursive: true });
  return Object.entries(renderJsonSchemas()).map(([name, content]) => {
    const path = join(outDir, jsonSchemaFileName(name as ContractSchemaName));
    writeFileSync(path, content, 'utf8');
    return path;
  });
};
