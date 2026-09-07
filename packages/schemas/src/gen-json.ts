/**
 * Dev script: `pnpm --filter @adgateio/schemas gen:json`.
 * Regenerates packages/schemas/json/*.schema.json from the Zod contract schemas.
 */
import { toJsonSchema } from './json-schema-files.js';

for (const path of toJsonSchema()) {
  process.stdout.write(`wrote ${path}\n`);
}
