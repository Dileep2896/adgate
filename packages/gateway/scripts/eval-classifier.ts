// `pnpm --filter @adgateio/gateway eval-classifier [--model <id>] [--limit <n>] [--concurrency <n>]`:
// scores a REAL model against fixtures/classify-fixtures.json. Needs CLASSIFIER_* and the
// network, so it is not part of `pnpm test`; it is how a change to CLASSIFIER_PROMPT is
// validated (CONTRIBUTING.md). The implementation (typechecked, unit-tested, also bundled to
// dist/scripts/eval-classifier.js) lives in src/scripts/eval-classifier.ts.
import { runEvalClassifierCli } from '../src/scripts/eval-classifier.js';

await runEvalClassifierCli(process.argv.slice(2));
