import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  classify,
  createLruCache,
  type ClassifyPolicy,
  OpenAiCompatibleClassifier,
} from '@adgateio/core';
import {
  ClassifyFixture,
  fixtureMessages,
  type ClassifyFixtureCase,
  PolicyConfig,
} from '@adgateio/schemas';

import { isMainModule } from '../cli.js';
import { type EnvSource, GatewayEnv } from '../config.js';
import { findRepoRoot, loadRootEnvFile } from '../env-file.js';
import { optionalFlag, parseFlags, UsageError } from './args.js';
import {
  type EvalResult,
  exitCodeFor,
  groupOf,
  renderJson,
  renderReport,
  summarize,
} from './eval-classifier-score.js';
import { runScript } from './run.js';

/**
 * `pnpm --filter @adgateio/gateway eval-classifier [--model <id>] [--limit <n>] [--concurrency <n>]
 * [--json]`: scores a REAL model against fixtures/classify-fixtures.json.
 *
 * The unit suite drives the classifier with FakeLlmClassifier seeded from those same fixtures, so
 * it asserts the merge logic and can never see the prompt. This is the other half: it builds the
 * same OpenAiCompatibleClassifier the gateway builds from CLASSIFIER_* and runs the real
 * classify() over every case. It needs a key and the network, so it is deliberately NOT part of
 * `pnpm test`; run it by hand after editing packages/core/src/classify/llm/prompt.ts.
 *
 * Exit code 1 only when sensitive recall is below 100 percent (the safety property). Band and
 * category misses are printed and exit 0: they are a tuning signal. Scoring lives in
 * eval-classifier-score.ts, which is pure and unit tested.
 */

export const EVAL_CLASSIFIER_USAGE = [
  'usage: eval-classifier [--model <id>] [--limit <n>] [--concurrency <n>] [--json]',
  '',
  '  --model        Model id, overriding CLASSIFIER_MODEL. Everything else comes from the',
  '                 CLASSIFIER_* variables the gateway itself reads (repo-root .env included).',
  '  --limit        Score only the first <n> cases, taken round robin from the sensitive,',
  '                 serve and low-intent groups so a small run still covers all three.',
  '  --concurrency  Cases in flight at once. Default 4.',
  '  --json         Print the summary as JSON instead of the report, for trending in CI.',
  '',
  'Cost: one API call per case that the rules stage does not short-circuit and the cache does',
  'not answer, so a full 85-case run is about 51 calls (the 34 sensitive fixtures are caught by',
  'the rules and never reach the model). Each call is bounded by CLASSIFIER_TIMEOUT_MS, which',
  'must be raised well above its 400 ms default for a hosted endpoint (2500 works for Mistral).',
  '',
  'Exit code 1 when a sensitive case lost an expected category; 0 otherwise. Intent band and',
  'category misses are reported and never fatal. The API key is never printed.',
  '',
].join('\n');

export const DEFAULT_EVAL_CONCURRENCY = 4;
export const EVAL_FIXTURE_PATH = join('fixtures', 'classify-fixtures.json');

/** The classifier is scored under the PolicyConfig defaults, so the run matches a default app. */
export const EVAL_POLICY: ClassifyPolicy = (() => {
  const policy = PolicyConfig.parse({ app_id: 'app_eval_classifier' });
  return {
    sensitive_detection: policy.sensitive_detection,
    min_confidence: policy.min_confidence,
  };
})();

export interface EvalClassifierArgs {
  model: string | null;
  limit: number | null;
  concurrency: number;
  json: boolean;
}

const positiveInt = (
  flags: Record<string, string | true>,
  name: string,
  fallback: number | null,
): number | null => {
  const raw = optionalFlag(flags, name);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`--${name} must be a positive integer`);
  }
  return value;
};

export const parseEvalClassifierArgs = (
  argv: readonly string[],
): { help: true } | ({ help: false } & EvalClassifierArgs) => {
  const { help, flags } = parseFlags(argv, {
    model: 'string',
    limit: 'string',
    concurrency: 'string',
    json: 'boolean',
  });
  if (help) {
    return { help: true };
  }
  return {
    help: false,
    model: optionalFlag(flags, 'model'),
    limit: positiveInt(flags, 'limit', null),
    concurrency: positiveInt(flags, 'concurrency', DEFAULT_EVAL_CONCURRENCY) ?? 1,
    json: flags['json'] === true,
  };
};

/** Blank values mean "not set", exactly like loadConfig's own compaction. */
const compact = (env: EnvSource): Record<string, string> => {
  const present: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') {
      present[key] = value;
    }
  }
  return present;
};

const CLASSIFIER_ENV = GatewayEnv.pick({
  CLASSIFIER_BASE_URL: true,
  CLASSIFIER_API_KEY: true,
  CLASSIFIER_MODEL: true,
  CLASSIFIER_TIMEOUT_MS: true,
});

export interface EvalClassifierConfig {
  baseUrl: string;
  /** Never printed, never logged. */
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/**
 * The CLASSIFIER_* slice of the gateway environment, read through the gateway's own schema so
 * this command can never disagree with the server about what a variable means.
 */
export const classifierConfigFromEnv = (
  env: EnvSource,
  modelOverride: string | null = null,
): EvalClassifierConfig => {
  const parsed = CLASSIFIER_ENV.safeParse(compact(env));
  if (!parsed.success) {
    throw new UsageError(
      `invalid classifier environment: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  const model = modelOverride ?? parsed.data.CLASSIFIER_MODEL;
  if (parsed.data.CLASSIFIER_BASE_URL === undefined || model === undefined) {
    throw new UsageError(
      'CLASSIFIER_BASE_URL and CLASSIFIER_MODEL (or --model) must be set: this command scores a real model, there is nothing to evaluate without one',
    );
  }
  return {
    baseUrl: parsed.data.CLASSIFIER_BASE_URL,
    apiKey: parsed.data.CLASSIFIER_API_KEY ?? '',
    model,
    timeoutMs: parsed.data.CLASSIFIER_TIMEOUT_MS,
  };
};

export const loadFixtureCases = (): ClassifyFixtureCase[] => {
  const root = findRepoRoot();
  if (root === null) {
    throw new UsageError(`not inside the repo: ${EVAL_FIXTURE_PATH} could not be located`);
  }
  return ClassifyFixture.parse(JSON.parse(readFileSync(join(root, EVAL_FIXTURE_PATH), 'utf8')))
    .cases;
};

/**
 * The first `limit` cases taken round robin from the sensitive, serve and low-intent groups, in
 * fixture order. Taking the first n of the file would give a small --limit nothing but sensitive
 * cases, which are the ones the rules answer without calling the model at all.
 */
export const selectCases = (
  cases: readonly ClassifyFixtureCase[],
  limit: number | null,
): ClassifyFixtureCase[] => {
  if (limit === null || limit >= cases.length) {
    return [...cases];
  }
  const groups = new Map<string, ClassifyFixtureCase[]>([
    ['sensitive', []],
    ['serve', []],
    ['low', []],
  ]);
  for (const c of cases) {
    groups.get(groupOf(c.id))?.push(c);
  }
  const keep = new Set<string>();
  const deepest = Math.max(...[...groups.values()].map((group) => group.length));
  for (let index = 0; index < deepest && keep.size < limit; index += 1) {
    for (const group of groups.values()) {
      const c = group[index];
      if (c !== undefined && keep.size < limit) {
        keep.add(c.id);
      }
    }
  }
  return cases.filter((c) => keep.has(c.id));
};

/**
 * Classifies every case with a worker pool. Each call is bounded twice (the client's own timeout
 * aborts the fetch, classify()'s deadline abandons the promise), so a stuck endpoint costs
 * CLASSIFIER_TIMEOUT_MS per case and never hangs the command.
 */
export const runEval = async (
  cases: readonly ClassifyFixtureCase[],
  config: EvalClassifierConfig,
  concurrency: number,
): Promise<EvalResult[]> => {
  const llm = new OpenAiCompatibleClassifier({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
    fetch: (url, init) => globalThis.fetch(url, init),
  });
  const cache = createLruCache();
  const results = new Array<EvalResult>(cases.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < cases.length; index = next++) {
      const fixture = cases[index];
      if (fixture === undefined) {
        continue;
      }
      // The whole conversation, not fixture.text: a multi-turn case is only itself when the
      // model sees the turns its expectation was written against.
      const outcome = await classify(
        { messages: fixtureMessages(fixture) },
        { llm, cache, policy: EVAL_POLICY, timeoutMs: config.timeoutMs },
      );
      results[index] = {
        fixture,
        observed: {
          commercial_intent: outcome.classification.commercial_intent,
          categories: outcome.classification.categories,
          sensitive: outcome.classification.sensitive,
          method: outcome.classification.method,
          source: outcome.source,
          latency_ms: outcome.latency_ms,
          llm_failure: outcome.llm_failure,
        },
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, cases.length)) }, worker),
  );
  return results.filter((result): result is EvalResult => result !== undefined);
};

const main = async (argv: readonly string[]): Promise<string> => {
  const args = parseEvalClassifierArgs(argv);
  if (args.help) {
    return EVAL_CLASSIFIER_USAGE;
  }
  loadRootEnvFile();
  const config = classifierConfigFromEnv(process.env, args.model);
  const cases = selectCases(loadFixtureCases(), args.limit);
  process.stderr.write(
    `classifying ${String(cases.length)} fixture cases with ${config.model} at concurrency ${String(args.concurrency)} (timeout ${String(config.timeoutMs)} ms)...\n`,
  );
  const summary = summarize(await runEval(cases, config, args.concurrency), {
    model: config.model,
    baseUrl: config.baseUrl,
  });
  process.exitCode = exitCodeFor(summary);
  return args.json ? renderJson(summary) : renderReport(summary);
};

export const runEvalClassifierCli = (argv: readonly string[]): Promise<void> =>
  runScript({ usage: EVAL_CLASSIFIER_USAGE, main }, argv);

if (isMainModule(import.meta.url)) {
  await runEvalClassifierCli(process.argv.slice(2));
}
