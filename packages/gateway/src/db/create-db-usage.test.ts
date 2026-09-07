import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRepoRoot } from '../env-file.js';

/**
 * The statement-timeout split, enforced rather than remembered.
 *
 * createDb, in db/client.ts, puts a 2000 ms statement_timeout on every session so a wedged
 * connection makes /v1/evaluate fail closed instead of hanging. That is right for the deployed
 * gateway and wrong for a test run: on a loaded shared CI runner the guard fires on healthy
 * queries and the suite goes red for no reason (7ae1fc3). Integration tests therefore open their
 * handles with createTestDb (db/test-support.ts), which carries the larger test budget.
 *
 * The moment one test file goes back to calling createDb directly it gets the production budget
 * back, silently, and the flake returns - so this test walks the repository and fails on any
 * caller that is not on the list below. Adding an entry has to be a decision somebody makes on
 * purpose, with the reason written down.
 */

const root = findRepoRoot();
if (root === null) {
  throw new Error('repo root not found');
}

const SCAN_ROOTS = ['packages', 'scripts', 'examples'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  'playwright-report',
  'test-results',
]);
const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/;

/** A call to createDb, not a mention of it: `gateway.createDb` and `createTestDb` do not match. */
const CREATE_DB_CALL = /(?<![A-Za-z0-9_$.])createDb\s*\(/;
const CREATE_TEST_DB_CALL = /(?<![A-Za-z0-9_$.])createTestDb\s*\(/;
const INTEGRATION_TEST = /\.integration\.test\.tsx?$/;

const sourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, out);
    } else if (SOURCE_FILE.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
};

interface SourceFile {
  path: string;
  source: string;
}

const repositoryFiles = (): SourceFile[] => {
  const files: SourceFile[] = [];
  for (const name of SCAN_ROOTS) {
    const dir = join(root, name);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }
    for (const path of sourceFiles(dir)) {
      files.push({
        path: relative(root, path).split(sep).join('/'),
        source: readFileSync(path, 'utf8'),
      });
    }
  }
  return files;
};

/**
 * Every file allowed to call createDb, with the reason. Anything that opens a handle against
 * DATABASE_URL_TEST belongs in the other column: it uses createTestDb instead. db/client.ts is
 * not listed because it only defines the function; it never calls it.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'packages/gateway/src/db/test-support.ts':
    'createTestDb wraps it with the larger test timeouts; this is the wrapper every integration test goes through.',
  'packages/gateway/src/server.ts':
    'The deployed gateway, which is exactly where the 2 s production statement_timeout belongs.',
  'packages/gateway/src/db/migrate.ts':
    'The migration runner, which passes MIGRATION_DB_OPTIONS (one connection, no timeouts) and runs from a shell, not a request.',
  'packages/gateway/src/scripts/run.ts':
    'The operator CLI harness (create-app, seed-creatives, retention): a developer at a terminal, with the production budget on purpose.',
  'packages/gateway/src/db/client.integration.test.ts':
    "The one test whose subject IS createDb's own defaults; routing it through createTestDb would test the factory instead of the thing being pinned.",
};

const files = repositoryFiles();
const callers = files
  .filter((file) => CREATE_DB_CALL.test(file.source))
  .map((file) => file.path)
  .sort();

/** The dashboard opens its own handles; lib/db.ts carries the same override for its suites. */
const DASHBOARD_HANDLE_CALL = /(?<![A-Za-z0-9_$.])create(?:ReadOnly|Write)Db\s*\(/;
const dashboardIntegrationTests = files.filter(
  (file) => file.path.startsWith('packages/dashboard/') && INTEGRATION_TEST.test(file.path),
);

describe('createDb callers', () => {
  it('finds the files it is supposed to be searching', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(callers).toContain('packages/gateway/src/server.ts');
    expect(callers).toContain('packages/gateway/src/db/test-support.ts');
  });

  it('leaves no integration test opening a handle with the production statement timeout', () => {
    const unexpected = callers.filter((file) => ALLOWED[file] === undefined);
    expect(
      unexpected,
      `These call createDb directly, so their sessions carry the 2 s production statement_timeout and will flake on a loaded CI runner. Use createTestDb from packages/gateway/src/db/test-support.ts, or add the file to ALLOWED in this test with the reason it needs the production budget:\n${unexpected.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the allow list free of stale entries, with a reason on each', () => {
    expect(Object.keys(ALLOWED).filter((file) => !callers.includes(file))).toEqual([]);
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, file).toBeGreaterThan(40);
    }
  });

  it('has the gateway integration suites actually going through the factory', () => {
    const throughFactory = files
      .filter(
        (file) =>
          file.path.startsWith('packages/gateway/src/') && CREATE_TEST_DB_CALL.test(file.source),
      )
      .map((file) => file.path);
    // The suites plus the evaluate harness: if this collapses, the factory has been bypassed.
    expect(throughFactory.length).toBeGreaterThanOrEqual(10);
    expect(throughFactory).toContain('packages/gateway/src/evaluate/test-support.ts');
  });

  it('has the dashboard integration suites passing their own test timeout', () => {
    const withoutOverride = dashboardIntegrationTests
      .filter(
        (file) =>
          DASHBOARD_HANDLE_CALL.test(file.source) &&
          !file.source.includes('testStatementTimeoutMs'),
      )
      .map((file) => file.path);
    expect(
      withoutOverride,
      'pass testStatementTimeoutMs() from lib/db.ts as the second argument of createReadOnlyDb/createWriteDb',
    ).toEqual([]);
    expect(dashboardIntegrationTests.length).toBeGreaterThanOrEqual(6);
  });
});
