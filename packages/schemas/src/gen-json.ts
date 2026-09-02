/**
 * Dev script: `pnpm --filter @adgate/schemas gen:json`.
 * Regenerates packages/schemas/json/*.schema.json from the Zod contract schemas.
 */
import { toJsonSchema } from './json-schema.js';

for (const path of toJsonSchema()) {
  process.stdout.write(`wrote ${path}\n`);
}
