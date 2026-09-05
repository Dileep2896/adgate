// `pnpm docs:api`: regenerates docs/api-reference.md from the OpenAPI document. The
// implementation (typechecked and tested) lives in src/scripts/api-reference.ts, and the
// rendering itself in src/openapi/reference.ts. docs/api.md is the human contract: never
// generated, never touched by this script.
import { runApiReferenceCli } from '../src/scripts/api-reference.js';

runApiReferenceCli();
