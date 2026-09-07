// `pnpm --filter @adgateio/gateway retention [--dry-run] [--app <app_id>] [--now <iso>]`: the
// cron entry of the retention job docs/privacy.md documents. The implementation (typechecked,
// tested, also bundled to dist/scripts/retention.js) lives in src/retention/ with its command
// line in src/scripts/retention.ts.
import { runRetentionCli } from '../src/scripts/retention.js';

await runRetentionCli(process.argv.slice(2));
