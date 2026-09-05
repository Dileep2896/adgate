import { readFileSync } from 'node:fs';

import { createKeyRing, verify } from '@adgate/core';

import { bundleVerifyContexts, ReportBundleSchema } from '../lib/report-bundle';

/**
 * Re-verify a verification report bundle OFFLINE.
 *
 *   pnpm exec tsx packages/dashboard/scripts/verify-bundle.ts <bundle.json>
 *
 * No database, no network, no adgate deployment: it reads the file, rebuilds each record's
 * VerifyContext from the records inside the bundle itself (lib/report-bundle.ts), runs
 * @adgate/core's verify() against the public keys the bundle carries, and prints a pass/fail
 * line per record plus a summary. Exit code 0 when every record verifies, 1 when any does not
 * and 2 when the file cannot be read at all.
 *
 * THIS IS THE POINT OF THE BUNDLE. An advertiser is told "your ad ran 400 times, the disclosure
 * was present every time and the chain is intact". They should not have to believe us: this
 * script - forty lines over a public library - is how they check, and
 * lib/report-generate.integration.test.ts runs it against a freshly generated bundle so the
 * claim cannot quietly stop being true.
 */

const USAGE = 'usage: tsx scripts/verify-bundle.ts <bundle.json>';

/** Exit codes: 0 every record verified, 1 a record failed, 2 the bundle could not be read. */
export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_UNREADABLE = 2;

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(EXIT_UNREADABLE);
};

const main = (): void => {
  const path = process.argv[2];
  if (path === undefined || path === '') {
    fail(USAGE);
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof Error ? error.message : 'unreadable'}`);
    return;
  }

  const parsed = ReportBundleSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    fail(`${path} is not an adgate report bundle: ${issues}`);
    return;
  }
  const bundle = parsed.data;

  let ring;
  try {
    ring = createKeyRing(bundle.public_keys);
  } catch (error) {
    fail(`the bundle's public keys are unusable: ${error instanceof Error ? error.message : ''}`);
    return;
  }

  const lines: string[] = [
    `bundle      ${path}`,
    `report      ${bundle.report_id}`,
    `advertiser  ${bundle.advertiser.name} (${bundle.advertiser.domain})`,
    `period      ${bundle.period.start} .. ${bundle.period.end}`,
    `records     ${String(bundle.records.length)} reported, ${String(bundle.supporting_records.length)} supporting`,
    `keys        ${ring.key_ids.length === 0 ? '(none)' : ring.key_ids.join(', ')}`,
    '',
  ];

  const contexts = bundleVerifyContexts(bundle);
  let verified = 0;
  for (const entry of bundle.records) {
    const result = verify(entry.record, ring, contexts.get(entry.record_hash) ?? {});
    if (result.valid) {
      verified += 1;
      lines.push(`OK      ${entry.audit_id}`);
      continue;
    }
    const failed = result.checks
      .filter((check) => !check.ok)
      .map((check) => `${check.name}${check.detail === undefined ? '' : ` (${check.detail})`}`)
      .join(', ');
    lines.push(`FAILED  ${entry.audit_id}  ${failed}`);
  }

  const total = bundle.records.length;
  const ok = verified === total;
  lines.push('');
  lines.push(`verified ${String(verified)} of ${String(total)} records`);
  lines.push(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(ok ? EXIT_OK : EXIT_INVALID);
};

main();
