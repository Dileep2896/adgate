import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isMainModule } from '../cli.js';
import { findRepoRoot } from '../env-file.js';
import { optionalFlag, parseFlags, requireFlag, UsageError } from './args.js';
import { runScript } from './run.js';

/**
 * `pnpm --filter @adgate/gateway load -- --url <base> --key <api key> --app <app_id>
 * [--requests 200] [--concurrency 10] [--body examples/evaluate.json]`: drives POST
 * /v1/evaluate with the example body (app_id replaced, a fresh conversation_id and turn_id per
 * request so per_session caps never suppress everything) at the given concurrency and prints
 * the status, decision and reason distribution, client latency percentiles and the mean
 * server latency_ms. No dependencies: fetch and performance.now. docs/performance.md records
 * one run; packages/gateway/scripts/load.ts is the command line entry.
 */
export const LOAD_USAGE = [
  'usage: load --key <api key> --app <app_id> [--url <base>] [--requests <n>] [--concurrency <n>] [--body <json>]',
  '',
  '  --key          An app-role API key of --app (create-app prints one).',
  '  --app          The app_id written into every request.',
  '  --url          Gateway base URL. Default http://localhost:8787.',
  '  --requests     Total requests. Default 200.',
  '  --concurrency  Requests in flight at once. Default 10.',
  '  --body         An EvaluateRequest JSON file. Default <repo root>/examples/evaluate.json.',
  '',
  'Raise RATE_LIMIT_RPS / RATE_LIMIT_BURST on the gateway first, or most requests answer 429.',
  '',
].join('\n');

export const DEFAULT_LOAD_URL = 'http://localhost:8787';
export const DEFAULT_LOAD_BODY = join('examples', 'evaluate.json');

export interface LoadArgs {
  url: string;
  key: string;
  app: string;
  requests: number;
  concurrency: number;
  body: string | null;
}

const positiveInt = (flags: Record<string, string | true>, name: string, fallback: number) => {
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

export const parseLoadArgs = (
  argv: readonly string[],
): { help: true } | ({ help: false } & LoadArgs) => {
  const { help, flags } = parseFlags(argv, {
    url: 'string',
    key: 'string',
    app: 'string',
    requests: 'string',
    concurrency: 'string',
    body: 'string',
  });
  if (help) {
    return { help: true };
  }
  return {
    help: false,
    url: (optionalFlag(flags, 'url') ?? DEFAULT_LOAD_URL).replace(/\/+$/, ''),
    key: requireFlag(flags, 'key'),
    app: requireFlag(flags, 'app'),
    requests: positiveInt(flags, 'requests', 200),
    concurrency: positiveInt(flags, 'concurrency', 10),
    body: optionalFlag(flags, 'body'),
  };
};

/** One request as observed by the client. */
export interface LoadSample {
  status: number;
  /** Client-measured round trip. */
  ms: number;
  decision?: string;
  reason?: string | null;
  /** The gateway's own latency_ms when the response carried one. */
  latency_ms?: number;
  /** The Error name when the request itself failed (no HTTP status). */
  error?: string;
}

/** Nearest-rank percentile of an ascending list; 0 for an empty one. */
export const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? 0;
};

const tally = (values: readonly string[]): string => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return (
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, n]) => `${key}: ${n}`)
      .join(', ') || 'none'
  );
};

const ms = (value: number): string => `${value.toFixed(1)} ms`;

export const summarize = (
  samples: readonly LoadSample[],
  wallMs: number,
  args: LoadArgs,
): string => {
  const ok = samples.filter((s) => s.error === undefined);
  const latencies = ok.map((s) => s.ms).sort((a, b) => a - b);
  const server = ok.flatMap((s) => (s.latency_ms === undefined ? [] : [s.latency_ms]));
  const meanServer = server.length === 0 ? null : server.reduce((a, b) => a + b, 0) / server.length;
  const rps = wallMs > 0 ? (samples.length / wallMs) * 1000 : 0;
  return [
    `adgate load: ${samples.length} requests, concurrency ${args.concurrency}, POST ${args.url}/v1/evaluate`,
    `  wall time      ${wallMs.toFixed(0)} ms (${rps.toFixed(1)} req/s)`,
    `  status         ${tally(ok.map((s) => String(s.status)))}`,
    `  errors         ${samples.length - ok.length}${ok.length === samples.length ? '' : ` (${tally(samples.flatMap((s) => (s.error === undefined ? [] : [s.error])))})`}`,
    `  decisions      ${tally(ok.flatMap((s) => (s.decision === undefined ? [] : [s.reason ? `${s.decision}/${s.reason}` : s.decision])))}`,
    `  client latency p50 ${ms(percentile(latencies, 50))}  p95 ${ms(percentile(latencies, 95))}  p99 ${ms(percentile(latencies, 99))}  max ${ms(percentile(latencies, 100))}`,
    `  server latency ${meanServer === null ? 'n/a' : `mean ${ms(meanServer)} (latency_ms over ${server.length} responses)`}`,
    '',
  ].join('\n');
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LoadRun {
  samples: LoadSample[];
  wallMs: number;
}

const readDecision = (text: string): Pick<LoadSample, 'decision' | 'reason' | 'latency_ms'> => {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      ...(typeof parsed['decision'] === 'string' ? { decision: parsed['decision'] } : {}),
      ...(typeof parsed['reason'] === 'string' || parsed['reason'] === null
        ? { reason: parsed['reason'] as string | null }
        : {}),
      ...(typeof parsed['latency_ms'] === 'number' ? { latency_ms: parsed['latency_ms'] } : {}),
    };
  } catch {
    return {};
  }
};

/** Fires the requests with a worker pool of `concurrency` and measures each round trip. */
export const runLoad = async (
  args: LoadArgs,
  body: Record<string, unknown>,
  fetchImpl: FetchLike = (url, init) => globalThis.fetch(url, init),
): Promise<LoadRun> => {
  const runId = Date.now().toString(36);
  const samples: LoadSample[] = new Array<LoadSample>(args.requests);
  let next = 0;
  const one = async (index: number): Promise<LoadSample> => {
    const request = {
      ...body,
      app_id: args.app,
      conversation_id: `load_${runId}_${index}`,
      turn_id: 'turn_1',
    };
    const started = performance.now();
    try {
      const res = await fetchImpl(`${args.url}/v1/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${args.key}` },
        body: JSON.stringify(request),
      });
      const text = await res.text();
      const elapsed = performance.now() - started;
      return { status: res.status, ms: elapsed, ...(res.status === 200 ? readDecision(text) : {}) };
    } catch (error) {
      return {
        status: 0,
        ms: performance.now() - started,
        error: error instanceof Error ? error.name : 'NonError',
      };
    }
  };
  const worker = async (): Promise<void> => {
    for (let index = next++; index < args.requests; index = next++) {
      samples[index] = await one(index);
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: Math.min(args.concurrency, args.requests) }, worker));
  return { samples, wallMs: performance.now() - started };
};

const resolveBody = (file: string | null): string => {
  if (file !== null) {
    return file;
  }
  const root = findRepoRoot();
  if (root === null) {
    throw new UsageError('not inside the repo: pass --body <evaluate.json>');
  }
  return join(root, DEFAULT_LOAD_BODY);
};

const main = async (argv: readonly string[]): Promise<string> => {
  const args = parseLoadArgs(argv);
  if (args.help) {
    return LOAD_USAGE;
  }
  const file = resolveBody(args.body);
  const body: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new UsageError(`${file} must contain one EvaluateRequest object`);
  }
  const { samples, wallMs } = await runLoad(args, body as Record<string, unknown>);
  return summarize(samples, wallMs, args);
};

/** The command line entry (packages/gateway/scripts/load.ts and `node dist/scripts/load.js`). */
export const runLoadCli = (argv: readonly string[]): Promise<void> =>
  runScript({ usage: LOAD_USAGE, main }, argv);

if (isMainModule(import.meta.url)) {
  await runLoadCli(process.argv.slice(2));
}
