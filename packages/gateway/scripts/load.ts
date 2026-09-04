// `pnpm --filter @adgate/gateway load -- --key <api key> --app <app_id> [...]`: the load test
// entry docs/performance.md describes. The implementation (typechecked, unit-tested, also
// bundled to dist/scripts/load.js) lives in src/scripts/load.ts.
import { runLoadCli } from '../src/scripts/load.js';

await runLoadCli(process.argv.slice(2));
