// `pnpm --filter @adgate/gateway check-catalog [--app <app_id>]`: prints, per app, which catalog
// creatives can actually serve and the first reason the rest cannot. The implementation
// (typechecked, tested, also bundled to dist/scripts/check-catalog.js) lives in
// src/catalog/readiness.ts with its command line in src/scripts/check-catalog.ts.
import { runCheckCatalogCli } from '../src/scripts/check-catalog.js';

await runCheckCatalogCli(process.argv.slice(2));
