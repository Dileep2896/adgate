import type { AuditRecord, Classification, VerifyResponse } from '@adgate/schemas';

import type { ReportRecordInput } from './report';
import { VERIFY_CHECK_NAMES } from './verify-labels';

/**
 * The hand-written report fixture. Test-only: lib/report.test.ts computes every number in
 * lib/report.ts from it by hand, and lib/report-generate.integration.test.ts reuses the record
 * builder. It lives beside the module rather than inside the test file because the fixture is
 * the argument of the story's key acceptance criterion ("at least one attested, one unattested
 * and one suppress record") and deserves to be readable on its own.
 *
 * The documents are complete AuditRecords - every field docs/audit.md lists - but they are NOT
 * signed: lib/report.ts never hashes or verifies anything, it aggregates the verify() results it
 * is handed. Records that really verify are the integration test's job.
 */

/**
 * A distinct, WELL FORMED sha256 hash per label: the hex of the label's code points, padded to
 * 64 digits. It has to satisfy the schema's `sha256:<64 lowercase hex>` pattern, because
 * lib/report.test.ts checks the fixture against core's own verify() - a record that failed the
 * schema check for a cosmetic reason would make every one of those comparisons vacuous.
 */
const hash = (value: string): string => {
  const hex = [...value]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex.padEnd(64, '0').slice(0, 64)}`;
};

const classification = (
  categories: readonly string[],
  sensitive: readonly string[] = [],
): Classification => ({
  commercial_intent: 0.8,
  categories: [...categories] as Classification['categories'],
  sensitive: [...sensitive] as Classification['sensitive'],
  confidence: 0.9,
  method: 'rules',
  prompt_version: hash('prompt'),
});

export interface FixtureRecordOptions {
  id: string;
  appId: string;
  decision?: 'serve' | 'suppress';
  reason?: string | null;
  categories?: readonly string[];
  sensitive?: readonly string[];
  attested?: boolean;
  /** Empty means the disclosure label is missing, which fails disclosure compliance. */
  label?: string;
  /**
   * docs/policy.md allows only `after_answer` in v1, so a stored record with anything else
   * would not parse at all - the option exists so the compliance rule can be pinned directly.
   */
  position?: string;
  /** Same again for the style: `separate_block` is the only value v1 allows (an ad is never inline). */
  style?: string;
}

/** One complete AuditRecord, with only the fields the report reads varying. */
export const fixtureRecord = (options: FixtureRecordOptions): AuditRecord => {
  const decision = options.decision ?? 'serve';
  const attested = options.attested ?? false;
  return {
    id: options.id,
    app_id: options.appId,
    conversation_id_hash: hash('conv'),
    user_hash: null,
    turn_id: 'turn_1',
    ts: '2026-09-01T00:00:00.000Z',
    surface: { type: 'chat', placement: 'after_answer' },
    classification: classification(options.categories ?? [], options.sensitive ?? []),
    policy_version: 1,
    policy_hash: hash('policy'),
    policy_decisions: [{ rule: 'serve_to_tiers', result: 'pass' }],
    override_rejected: [],
    decision,
    reason: (options.reason ?? null) as AuditRecord['reason'],
    demand: {
      requested: ['direct'],
      responses: [{ source: 'direct', candidates: decision === 'serve' ? 1 : 0, latency_ms: 5 }],
      excluded: [],
      selected: decision === 'serve' ? 'direct' : null,
    },
    creative:
      decision === 'serve'
        ? {
            id: 'cr_fixture',
            advertiser: 'Fixture Co',
            advertiser_domain: 'fixture.example',
            content_hash: hash('creative'),
          }
        : null,
    disclosure: {
      label: options.label ?? 'Sponsored',
      position: (options.position ?? 'after_answer') as AuditRecord['disclosure']['position'],
      style: (options.style ?? 'separate_block') as AuditRecord['disclosure']['style'],
    },
    model_output_hash: attested ? hash('output') : null,
    separation_attestation: attested,
    attested_at: attested ? '2026-09-01T00:01:00.000Z' : null,
    supersedes_hash: attested ? hash('superseded') : null,
    prev_hash: 'genesis',
    record_hash: hash(options.id),
    signature: `ed25519:${'A'.repeat(86)}==`,
    key_id: 'k_2026_09',
  };
};

/** Every check ok: what verify() says about an untouched record. */
export const VALID: VerifyResponse = {
  valid: true,
  checks: VERIFY_CHECK_NAMES.map((name) => ({ name, ok: true })),
};

/** verify() with the named checks failing and the rest ok. */
export const invalidWith = (failing: readonly string[]): VerifyResponse => ({
  valid: false,
  checks: VERIFY_CHECK_NAMES.map((name) => ({
    name,
    ok: !failing.includes(name),
    detail: failing.includes(name) ? 'failed' : undefined,
  })),
});

/** What verify() returns for a document that is not an AuditRecord: every check fails. */
export const SCHEMA_INVALID: VerifyResponse = invalidWith(VERIFY_CHECK_NAMES);

export interface FixtureInputOptions extends FixtureRecordOptions {
  impressions?: number;
  clicks?: number;
  verification?: VerifyResponse;
  /** true stores an unreadable document: the record no longer parses. */
  unreadable?: boolean;
}

export const fixtureInput = (options: FixtureInputOptions): ReportRecordInput => ({
  auditId: options.id,
  recordHash: hash(options.id),
  appId: options.appId,
  appName: options.appId === 'app_alpha' ? 'Alpha' : 'Beta',
  ts: '2026-09-01T00:00:00.000Z',
  record: options.unreadable === true ? null : fixtureRecord(options),
  impressions: options.impressions ?? 0,
  clicks: options.clicks ?? 0,
  verification: options.verification ?? VALID,
});

/**
 * The six records lib/report.test.ts computes by hand.
 *
 *   R1 alpha  serve     ATTESTED    [database]          1 impression, 1 click   valid
 *   R2 alpha  serve     unattested  [database, flights] 1 impression, 1 click   valid
 *   R3 alpha  SUPPRESS  -           [flights]           no events               valid
 *   R4 beta   serve     unattested  [flights] SENSITIVE 1 impression            valid
 *   R5 beta   serve     unattested  no label            1 impression            record_hash, chain
 *   R6 beta   unreadable document                       no events               every check
 */
export const FIXTURE_RECORDS: ReportRecordInput[] = [
  fixtureInput({
    id: 'aud_r1',
    appId: 'app_alpha',
    attested: true,
    categories: ['software.devtools.database'],
    impressions: 1,
    clicks: 1,
  }),
  fixtureInput({
    id: 'aud_r2',
    appId: 'app_alpha',
    categories: ['software.devtools.database', 'travel.flights'],
    impressions: 1,
    clicks: 1,
  }),
  // R3 is a SHAPE THE CURRENT GATEWAY DOES NOT PRODUCE, kept deliberately: audit_records
  // .advertiser_id is written on serves only, so a suppression can never be selected into a
  // real report (lib/report-queries.ts). It stays because the arithmetic must be right the day
  // a suppressed turn can name the advertiser it would have served, and because it is what
  // proves the separation denominator is the serves and not every record.
  fixtureInput({
    id: 'aud_r3',
    appId: 'app_alpha',
    decision: 'suppress',
    reason: 'frequency_cap',
    categories: ['travel.flights'],
  }),
  fixtureInput({
    id: 'aud_r4',
    appId: 'app_beta',
    categories: ['travel.flights'],
    sensitive: ['health'],
    impressions: 1,
  }),
  fixtureInput({
    id: 'aud_r5',
    appId: 'app_beta',
    label: '',
    impressions: 1,
    verification: invalidWith(['record_hash', 'chain']),
  }),
  fixtureInput({
    id: 'aud_r6',
    appId: 'app_beta',
    unreadable: true,
    verification: SCHEMA_INVALID,
  }),
];
