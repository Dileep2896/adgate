import { readFileSync } from 'node:fs';

import {
  checkBundle,
  EXIT_UNREADABLE,
  parseBundleArgs,
  type BundleCheckResult,
} from '../lib/bundle-check';
import { ReportBundleSchema } from '../lib/report-bundle';

/**
 * Re-verify a verification report bundle OFFLINE.
 *
 *   pnpm exec tsx packages/dashboard/scripts/verify-bundle.ts <bundle.json>
 *     [--keys <public-keys.json>] [--key-id <key_id>]
 *
 * No database, no network, no adgate deployment: it reads the file, rebuilds each record's
 * VerifyContext from the records inside the bundle itself (lib/report-bundle.ts), runs
 * @adgate/core's verify() and prints a pass/fail line per record plus a summary. Exit code 0
 * when every record verifies, 1 when any does not, 2 when the file cannot be read at all and 3
 * when the bundle holds no records.
 *
 * THIS IS THE POINT OF THE BUNDLE. An advertiser is told "your ad ran 400 times, the disclosure
 * was present every time and the chain is intact". They should not have to believe us: this
 * script - a shell over a public library - is how they check, and
 * lib/report-generate.integration.test.ts runs it against a freshly generated bundle so the
 * claim cannot quietly stop being true.
 *
 * WITHOUT --keys IT PROVES CONSISTENCY, NOT PROVENANCE: the ring comes from the bundle, so a
 * fabricated file passes too. Pass the operator's published keys with --keys to check that the
 * records were signed by adgate, or at least --key-id to check that they name the key you
 * expected. lib/bundle-check.ts decides all of that; this file only does I/O.
 */

const USAGE =
  'usage: tsx scripts/verify-bundle.ts <bundle.json> [--keys <keys.json>] [--key-id <id>]';

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(EXIT_UNREADABLE);
};

const readJson = (path: string, what: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return fail(
      `cannot read ${what} ${path}: ${error instanceof Error ? error.message : 'unreadable'}`,
    );
  }
};

const isPemMap = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((pem) => typeof pem === 'string');

const report = (result: BundleCheckResult): never => {
  process.stdout.write(`${result.lines.join('\n')}\n`);
  process.exit(result.code);
};

const main = (): void => {
  const args = parseBundleArgs(process.argv.slice(2));
  if (args.error !== null) {
    fail(`${args.error}\n${USAGE}`);
    return;
  }
  if (args.path === null || args.path === '') {
    fail(USAGE);
    return;
  }

  const parsed = ReportBundleSchema.safeParse(readJson(args.path, 'bundle'));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    fail(`${args.path} is not an adgate report bundle: ${issues}`);
    return;
  }

  let expectedKeys: Record<string, string> | null = null;
  if (args.keysPath !== null) {
    const keys = readJson(args.keysPath, 'key file');
    if (!isPemMap(keys)) {
      fail(`${args.keysPath} is not a JSON object of key_id -> public key PEM`);
      return;
    }
    expectedKeys = keys;
  }

  report(
    checkBundle({
      path: args.path,
      bundle: parsed.data,
      expectedKeys,
      keysPath: args.keysPath,
      expectedKeyId: args.keyId,
    }),
  );
};

main();
