import { createKeyRing, verify } from '@adgateio/core';
import { AuditRecord } from '@adgateio/schemas';

import { bundleVerifyContexts, type ReportBundleFile } from './report-bundle';

/**
 * OFFLINE RE-VERIFICATION OF A REPORT BUNDLE, as pure logic. scripts/verify-bundle.ts is the
 * file, argv and exit-code shell around it; everything that decides an outcome lives here so it
 * can be unit tested without spawning a process.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. Run with no key file, the ring comes from the bundle:
 * every record then verifies against keys the same file supplied, which proves the bundle is
 * INTERNALLY CONSISTENT and nothing more - a fabricated bundle, signed with a keypair someone
 * generated this morning, passes exactly the same way. That is a real limit of a self-describing
 * document, so it is printed as a warning on every such run rather than left to the reader.
 * `--keys <file>` (the operator's published key_id -> PEM map, obtained anywhere but the bundle)
 * is what turns the run into evidence; `--key-id <id>` is the weaker check that every record
 * names the key the reader expected.
 */

/** Exit codes: 0 verified, 1 a record failed, 2 unreadable input, 3 nothing to verify. */
export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_UNREADABLE = 2;
export const EXIT_EMPTY = 3;

export const NO_EXTERNAL_KEYS_WARNING =
  'WARNING: the public keys came from the bundle itself. This run proves the bundle is internally consistent, not that adgate signed it: re-run with --keys <file> holding the keys you obtained from the operator (or their published key list) to check that.';

export interface BundleCheckInput {
  /** The path the bundle was read from, for the header. */
  path: string;
  bundle: ReportBundleFile;
  /** key_id -> SPKI PEM the reader supplied out of band, or null when there was no --keys file. */
  expectedKeys?: Readonly<Record<string, string>> | null;
  /** Where those came from, for the header. */
  keysPath?: string | null;
  /** --key-id: every record must name this key, whatever the ring says. */
  expectedKeyId?: string | null;
}

export interface BundleCheckResult {
  lines: string[];
  code: number;
}

const failure = (message: string): BundleCheckResult => ({
  lines: [message, 'RESULT: FAIL'],
  code: EXIT_UNREADABLE,
});

/** The key_id a record names, or null when its document does not parse. */
const keyIdOf = (record: unknown): string | null =>
  AuditRecord.safeParse(record).data?.key_id ?? null;

/** Keys in the bundle that the expected list does not confirm: a re-signed bundle shows up here. */
const keyDisagreements = (
  bundle: ReportBundleFile,
  expected: Readonly<Record<string, string>>,
): string[] => {
  const normalise = (pem: string): string => pem.replace(/\s+/g, '');
  return Object.entries(bundle.public_keys).flatMap(([keyId, pem]) => {
    const known = expected[keyId];
    if (known === undefined) {
      return [`the bundle carries key ${keyId}, which the expected key list does not contain`];
    }
    return normalise(known) === normalise(pem)
      ? []
      : [`key ${keyId} in the bundle is NOT the one in the expected key list`];
  });
};

const header = (input: BundleCheckInput, keyIds: readonly string[]): string[] => {
  const { bundle } = input;
  const redacted = bundle.supporting_records.filter((record) => record.redacted === true).length;
  return [
    `bundle      ${input.path}`,
    `report      ${bundle.report_id}`,
    `advertiser  ${bundle.advertiser.name} (${bundle.advertiser.domain})`,
    `period      ${bundle.period.start} .. ${bundle.period.end}`,
    `generated   ${bundle.generated_at}`,
    `collected   ${bundle.collected_at ?? '(not stated)'}`,
    `records     ${String(bundle.records.length)} reported, ${String(bundle.supporting_records.length)} supporting (${String(redacted)} chain references only)`,
    `keys        ${keyIds.length === 0 ? '(none)' : keyIds.join(', ')} from ${
      input.keysPath === undefined || input.keysPath === null ? 'the bundle' : input.keysPath
    }`,
    '',
  ];
};

/**
 * Verifies every reported record in the bundle and returns the report to print with the exit
 * code to leave with. Never throws.
 */
export const checkBundle = (input: BundleCheckInput): BundleCheckResult => {
  const { bundle } = input;
  const expected = input.expectedKeys ?? null;

  let ring;
  try {
    ring = createKeyRing(expected ?? bundle.public_keys);
  } catch (error) {
    return failure(
      `the public keys are unusable: ${error instanceof Error ? error.message : 'unreadable'}`,
    );
  }

  const lines = header(input, ring.key_ids);
  if (expected === null) {
    lines.push(NO_EXTERNAL_KEYS_WARNING, '');
  } else {
    lines.push(...keyDisagreements(bundle, expected).map((note) => `NOTE    ${note}`));
  }

  let verified = 0;
  const contexts = bundleVerifyContexts(bundle);
  for (const entry of bundle.records) {
    const result = verify(entry.record, ring, contexts.get(entry.record_hash) ?? {});
    const keyId = keyIdOf(entry.record);
    const wrongKey =
      input.expectedKeyId !== undefined &&
      input.expectedKeyId !== null &&
      keyId !== input.expectedKeyId;
    if (result.valid && !wrongKey) {
      verified += 1;
      lines.push(`OK      ${entry.audit_id}`);
      continue;
    }
    const failed = result.checks
      .filter((check) => !check.ok)
      .map((check) => `${check.name}${check.detail === undefined ? '' : ` (${check.detail})`}`);
    if (wrongKey) {
      failed.push(`key_id (${keyId ?? 'unreadable'}, expected ${String(input.expectedKeyId)})`);
    }
    lines.push(`FAILED  ${entry.audit_id}  ${failed.join(', ')}`);
  }

  const total = bundle.records.length;
  lines.push('');
  lines.push(`verified ${String(verified)} of ${String(total)} records`);

  // A bundle with nothing in it is its own outcome: "every record verified" over zero records
  // is true and worthless, and printing PASS for it would be the most misleading line here.
  if (total === 0) {
    lines.push('RESULT: EMPTY - this bundle contains no records, so nothing was verified');
    return { lines, code: EXIT_EMPTY };
  }
  const ok = verified === total;
  lines.push(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  return { lines, code: ok ? EXIT_OK : EXIT_INVALID };
};

export interface BundleArgs {
  path: string | null;
  /** --keys <file>: the expected key_id -> PEM map. */
  keysPath: string | null;
  /** --key-id <id>. */
  keyId: string | null;
  error: string | null;
}

/** Parses argv (without node and the script). Unknown flags are an error, never ignored. */
export const parseBundleArgs = (argv: readonly string[]): BundleArgs => {
  const args: BundleArgs = { path: null, keysPath: null, keyId: null, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index] ?? '';
    if (value === '--keys' || value === '--key-id') {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        return { ...args, error: `${value} needs a value` };
      }
      if (value === '--keys') {
        args.keysPath = next;
      } else {
        args.keyId = next;
      }
      index += 1;
      continue;
    }
    if (value.startsWith('--')) {
      return { ...args, error: `unknown option ${value}` };
    }
    if (args.path !== null) {
      return { ...args, error: 'give exactly one bundle file' };
    }
    args.path = value;
  }
  return args;
};
