import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { findRepoRoot } from '../env-file.js';
import { sqlList } from './tables/columns.js';

/**
 * S36's SQL parameterization audit, as a test rather than a one-off review: it reads every
 * TypeScript file in the repository and flags each place that could build SQL as text instead
 * of letting drizzle or postgres.js parameterize it.
 *
 * Flagged: drizzle's `sql` raw escape hatch, postgres.js's `unsafe(...)`, and an UNTAGGED
 * template literal that starts with a SQL verb and interpolates something. A TAGGED template
 * (sql`...`, tx`...`) is not flagged: both drivers turn its interpolations into bind
 * parameters, which is exactly what we want every query to do.
 *
 * Every flagged file must appear in ALLOWED with the reason it is safe, and only
 * RUNTIME_ALLOWED files may be reached by a request; everything else is test, seed or
 * migration tooling that runs from a developer's shell with no request input in it.
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

/** Written this way so the scanner never flags its own patterns. */
const RAW_CALL = new RegExp(String.raw`\bsql\s*\.\s*raw\s*\(`, 'g');
const UNSAFE_CALL = new RegExp(String.raw`\.\s*unsafe\s*\(`, 'g');
const TEMPLATE = /`(?:[^`\\]|\\.)*`/gs;
const SQL_VERB = /^\s*(select|insert|update|delete|create|drop|alter|truncate|grant|copy)\b/i;
const INTERPOLATION = /\$\{(?:[^{}]|\{[^{}]*\})*\}/g;
const TAG_BEFORE = /([A-Za-z0-9_$.]+)$/;
const GENERIC_ARGS = /<[^<>]*(?:<[^<>]*>[^<>]*)*>$/;

export interface SqlFinding {
  file: string;
  line: number;
  kind: 'raw' | 'unsafe' | 'interpolated-template';
}

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

const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length;

/** The identifier a template literal is tagged with, or '' when it is a plain template. */
const tagOf = (source: string, index: number): string => {
  let before = source.slice(Math.max(0, index - 400), index).replace(/\s+$/, '');
  if (before.endsWith('>')) {
    before = before.replace(GENERIC_ARGS, '');
  }
  return TAG_BEFORE.exec(before)?.[1] ?? '';
};

const findingsIn = (source: string, file: string): SqlFinding[] => {
  const findings: SqlFinding[] = [];
  for (const [kind, pattern] of [
    ['raw', RAW_CALL],
    ['unsafe', UNSAFE_CALL],
  ] as const) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      findings.push({ file, line: lineOf(source, match.index), kind });
    }
  }
  TEMPLATE.lastIndex = 0;
  let template: RegExpExecArray | null;
  while ((template = TEMPLATE.exec(source)) !== null) {
    const body = template[0];
    if (!body.includes('${') || !SQL_VERB.test(body.slice(1, -1).replace(INTERPOLATION, ' '))) {
      continue;
    }
    if (tagOf(source, template.index) === '') {
      findings.push({ file, line: lineOf(source, template.index), kind: 'interpolated-template' });
    }
  }
  return findings;
};

const scanRepository = (): SqlFinding[] => {
  const findings: SqlFinding[] = [];
  for (const name of SCAN_ROOTS) {
    const dir = join(root, name);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }
    for (const path of sourceFiles(dir)) {
      findings.push(
        ...findingsIn(readFileSync(path, 'utf8'), relative(root, path).split(sep).join('/')),
      );
    }
  }
  return findings;
};

/**
 * The one file on the request path that builds SQL text. sqlList renders a CHECK constraint's
 * IN list from a contract enum (AUDIT_DECISIONS, EVENT_TYPES, ...) at schema-definition time:
 * the values are module constants, never request input, and the test below proves the render
 * takes no parameters and escapes a quote.
 */
const RUNTIME_ALLOWED: Readonly<Record<string, string>> = {
  'packages/gateway/src/db/tables/columns.ts':
    'sqlList() renders a CHECK IN list from contract enum constants at import time; drizzle-kit needs literal DDL, and no request value ever reaches it.',
};

/** Test, seed and migration tooling. None of it runs inside a request. */
const TOOLING_ALLOWED: Readonly<Record<string, string>> = {
  'packages/gateway/src/db/test-support.ts':
    'TRUNCATE of TABLE_NAMES between integration tests; the identifier list is the schema constant, quoted.',
  'packages/gateway/src/evaluate/test-support.ts':
    'The harness truncates a constant table list and reads row_to_json from each TABLE_NAMES entry; test-only, no request input.',
  'packages/gateway/src/db/migrate.integration.test.ts':
    'Applies and breaks migration SQL read from packages/gateway/drizzle to prove migrations run and fail loudly.',
  'packages/gateway/src/audit-api/audit-chain.integration.test.ts':
    'Tampers with rows on purpose to prove the chain check catches it.',
  'packages/gateway/src/audit-api/audit-tamper.integration.test.ts':
    'Tampers with a stored record on purpose to prove verify() reports it invalid.',
  'packages/gateway/src/evaluate/evaluate-resilience.integration.test.ts':
    'Installs and drops a constant trigger that blocks audit inserts, to prove the fail-closed path.',
  'packages/gateway/src/rate-limit/pg.integration.test.ts':
    'Renames the rate_limits table (constant DDL) to prove a limiter outage lets traffic through.',
  'packages/gateway/src/db/schema.test.ts':
    'Asserts the committed migration SQL contains CREATE TABLE for every TABLE_NAMES entry; the string is compared, never executed.',
  'packages/dashboard/lib/metrics-seed.ts':
    'Dev/test fixture loader: row counts come from module constants and every value is a $1 bind parameter.',
  'packages/dashboard/lib/metrics-test-db.ts':
    'Creates the metrics test database; CREATE DATABASE takes no parameters, and the name comes from DATABASE_URL_TEST with quotes doubled.',
  'packages/dashboard/e2e/seed.ts':
    'Playwright fixture: TRUNCATE of the TABLE_NAMES constant, quoted.',
};

const ALLOWED: Readonly<Record<string, string>> = { ...RUNTIME_ALLOWED, ...TOOLING_ALLOWED };

const findings = scanRepository();
const filesWithFindings = [...new Set(findings.map((finding) => finding.file))].sort();

const describeFindings = (files: readonly string[]): string =>
  files
    .map((file) => {
      const lines = findings
        .filter((finding) => finding.file === file)
        .map((finding) => `${finding.kind}@${finding.line}`)
        .join(', ');
      return `${file}: ${lines}`;
    })
    .join('\n');

describe('SQL parameterization audit', () => {
  it('scans the repository and finds the queries it is meant to find', () => {
    // A sanity check on the scanner itself: if it stops finding the known raw call it is
    // no longer looking at anything.
    expect(findings.length).toBeGreaterThan(10);
    expect(filesWithFindings).toContain('packages/gateway/src/db/tables/columns.ts');
  });

  it('leaves no file outside the allow list building SQL from a string', () => {
    const unexpected = filesWithFindings.filter((file) => ALLOWED[file] === undefined);
    expect(
      unexpected,
      `Unreviewed raw SQL. Parameterize it (sql\`...\` with interpolated values) or add the file to ALLOWED in this test with the reason it is safe:\n${describeFindings(unexpected)}`,
    ).toEqual([]);
  });

  it('keeps the allow list free of stale entries', () => {
    const stale = Object.keys(ALLOWED).filter((file) => !filesWithFindings.includes(file));
    expect(stale, 'these allow-list entries no longer build SQL text; delete them').toEqual([]);
  });

  it('allows exactly one file on the request path, and every reason is written down', () => {
    expect(Object.keys(RUNTIME_ALLOWED)).toEqual(['packages/gateway/src/db/tables/columns.ts']);
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, file).toBeGreaterThan(40);
    }
    // Everything else is test, seed or migration tooling by its path.
    for (const file of Object.keys(TOOLING_ALLOWED)) {
      expect(file, file).toMatch(
        /(\.test\.ts$|test-support\.ts$|seed\.ts$|-seed\.ts$|-test-db\.ts$)/,
      );
    }
  });

  it('renders sqlList as literal constants with no bind parameters and doubles a quote', () => {
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(sqlList(['serve', 'suppress']))).toMatchObject({
      sql: "'serve', 'suppress'",
      params: [],
    });
    expect(dialect.sqlToQuery(sqlList(["o'brien"])).sql).toBe("'o''brien'");
  });
});
