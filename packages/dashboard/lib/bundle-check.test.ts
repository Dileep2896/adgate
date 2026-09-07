import {
  attest,
  type AuditSigningKey,
  buildAuditRecord,
  creativeContentHash,
  derivePublicPem,
  generateKeypair,
  loadPolicyFromYaml,
  nextPrevHash,
  prefixedUlid,
  sha256Prefixed,
} from '@adgateio/core';
import type { AuditRecord, Candidate, Classification, DemandTrace } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { FIXTURE_CANDIDATE, OTHER_CANDIDATE } from './audit-fixtures';
import {
  checkBundle,
  EXIT_EMPTY,
  EXIT_INVALID,
  EXIT_OK,
  NO_EXTERNAL_KEYS_WARNING,
  parseBundleArgs,
} from './bundle-check';
import { computeReport, type ReportDocument } from './report';
import {
  buildReportBundle,
  type BundleRecord,
  type ReportBundleFile,
  type SupportingRecord,
} from './report-bundle';

/**
 * The offline verifier, without a database and without a process.
 *
 * The chain below is REAL - core's buildAuditRecord, a keypair generated in this test, prev_hash
 * chained the way the gateway chains it - because every claim here is about what verify() says,
 * and a placeholder record would fail every check for the wrong reason. It is deliberately a
 * MIXED chain: the reported advertiser's serve sits between two serves of a competitor, which is
 * what an app's chain actually looks like and the shape the redaction exists for.
 */

const SALT = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
const APP_ID = 'app_00000000000000000000000000';
const { policy, policy_hash } = loadPolicyFromYaml(`version: 1\napp_id: ${APP_ID}\n`);

const classification = (category: string): Classification => ({
  commercial_intent: 0.8,
  categories: [category] as Classification['categories'],
  sensitive: [],
  confidence: 0.9,
  method: 'rules',
  prompt_version: sha256Prefixed('bundle-check-prompt'),
});

const TRACE: DemandTrace = {
  requested: ['direct'],
  responses: [{ source: 'direct', candidates: 1, latency_ms: 4 }],
  excluded: [],
  selected: 'direct',
};

interface Turn {
  candidate: Candidate;
  category: string;
}

const TURNS: Turn[] = [
  // seq 1 and 3 are the competitor's; seq 2 is the advertiser the report is for, so its
  // predecessor is a record it must never be shown.
  { candidate: OTHER_CANDIDATE, category: 'shopping.sportswear' },
  { candidate: FIXTURE_CANDIDATE, category: 'software.devtools.database' },
  { candidate: OTHER_CANDIDATE, category: 'shopping.sportswear' },
];

const signingKey = (): AuditSigningKey => {
  const keypair = generateKeypair();
  return { key_id: keypair.key_id, private_pem: keypair.private_pem };
};

const chainOf = (signing: AuditSigningKey): AuditRecord[] => {
  const records: AuditRecord[] = [];
  let previous: AuditRecord | null = null;
  for (const [index, turn] of TURNS.entries()) {
    const record = buildAuditRecord({
      id: prefixedUlid('aud_'),
      app: { app_id: APP_ID, salt: SALT },
      conversation_id: `conv_${String(index)}`,
      turn_id: `turn_${String(index + 1)}`,
      ts: new Date(Date.UTC(2026, 5, 1, 0, index)).toISOString(),
      surface: { type: 'chat', placement: 'after_answer', max_creatives: 1 },
      classification: classification(turn.category),
      policy: { policy_version: 1, policy_hash, disclosure: policy.disclosure },
      policyResult: {
        allowed: true,
        reason: null,
        decisions: [{ rule: 'serve_to_tiers', result: 'pass' }],
      },
      mediation: { selected: turn.candidate, trace: TRACE },
      prev_hash: nextPrevHash(previous),
      signing,
    });
    records.push(record);
    previous = record;
  }
  return records;
};

const bundleRecordOf = (record: AuditRecord, seq: number): BundleRecord => ({
  audit_id: record.id,
  app_id: record.app_id,
  seq,
  record_hash: record.record_hash,
  is_latest: true,
  ts: record.ts,
  record,
});

const DOCUMENT: ReportDocument = computeReport({
  advertiser: {
    id: 'adv_audit_fixture',
    name: FIXTURE_CANDIDATE.advertiser,
    domain: FIXTURE_CANDIDATE.advertiser_domain,
  },
  period: { start: '2026-06-01T00:00:00.000Z', end: '2026-06-02T00:00:00.000Z' },
  generatedAt: '2026-06-02T00:00:00.000Z',
  records: [],
  truncated: false,
  recordLimit: 2000,
});

interface Fixture {
  bundle: ReportBundleFile;
  keys: Record<string, string>;
  signing: AuditSigningKey;
}

/**
 * The bundle for the middle turn, ATTESTED - which is the shape with something to hide. Its
 * reported record is the attestation at seq 4, so the supporting set is everything the checks
 * reach: the attestation's positional predecessor (seq 3, the COMPETITOR's), the version it
 * supersedes (the advertiser's own turn, carried whole) and that version's predecessor (seq 1,
 * the competitor's again). Attested because verify() fails `separation_attested` on any
 * unattested serve, and a fixture that could never be valid proves nothing about validity.
 */
const fixture = (): Fixture => {
  const signing = signingKey();
  const keys = { [signing.key_id]: derivePublicPem(signing.private_pem) };
  const chain = chainOf(signing);
  const original = chain[1] as AuditRecord;
  const attestation = attest(original, sha256Prefixed('model output'), '2026-06-01T00:05:00.000Z', {
    prev_hash: nextPrevHash(chain[2] as AuditRecord),
    signing,
  });
  const reported = attestation;
  const supporting: SupportingRecord[] = [
    { ...bundleRecordOf(chain[2] as AuditRecord, 3), role: 'predecessor' },
    { ...bundleRecordOf(original, 2), role: 'superseded' },
    { ...bundleRecordOf(chain[0] as AuditRecord, 1), role: 'predecessor' },
  ];
  const bundle = buildReportBundle({
    reportId: 'rep_00000000000000000000000000',
    generatedAt: '2026-06-02T00:00:00.000Z',
    collectedAt: '2026-06-09T00:00:00.000Z',
    advertiser: DOCUMENT.advertiser,
    period: DOCUMENT.period,
    report: DOCUMENT,
    records: [bundleRecordOf(reported, 4)],
    supportingRecords: supporting,
    creatives: [
      {
        id: FIXTURE_CANDIDATE.id,
        advertiser: FIXTURE_CANDIDATE.advertiser,
        advertiser_domain: FIXTURE_CANDIDATE.advertiser_domain,
        headline: FIXTURE_CANDIDATE.headline,
        body: FIXTURE_CANDIDATE.body,
        cta: FIXTURE_CANDIDATE.cta,
        url_template: FIXTURE_CANDIDATE.url_template,
      },
    ],
    publicKeys: keys,
  });
  return { bundle, keys, signing };
};

type BundleOptions = Parameters<typeof checkBundle>[0];

const run = (
  bundle: ReportBundleFile,
  options: Omit<Partial<BundleOptions>, 'bundle' | 'path'> = {},
) => checkBundle({ path: 'bundle.json', bundle, ...options });

describe('checkBundle', () => {
  it('verifies a record whose predecessor is only a chain reference', () => {
    const { bundle } = fixture();
    // The competitor's record was reduced by buildReportBundle, and the check still passes:
    // core's checkChain reads record_hash and app_id, which is exactly what is left.
    const references = bundle.supporting_records.filter((entry) => entry.redacted === true);
    expect(references).toHaveLength(2);
    for (const entry of references) {
      expect(entry.record).toEqual({ record_hash: entry.record_hash, app_id: entry.app_id });
    }
    // The superseded version of the advertiser's OWN turn is kept whole: the supersedes check
    // re-verifies it, body and all.
    const full = bundle.supporting_records.filter((entry) => entry.redacted !== true);
    expect(full).toHaveLength(1);
    expect((full[0]?.record as { creative?: { id?: string } }).creative?.id).toBe(
      FIXTURE_CANDIDATE.id,
    );

    const result = run(bundle);
    expect(result.lines.join('\n')).toContain('verified 1 of 1 records');
    expect(result.code).toBe(EXIT_OK);
  });

  it('carries nothing of the other advertiser', () => {
    const { bundle } = fixture();
    const serialized = JSON.stringify(bundle);
    for (const secret of [
      OTHER_CANDIDATE.id,
      OTHER_CANDIDATE.advertiser,
      OTHER_CANDIDATE.advertiser_domain,
      OTHER_CANDIDATE.headline,
      OTHER_CANDIDATE.body,
      'shopping.sportswear',
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it('warns, loudly, when the only keys came from the bundle itself', () => {
    const { bundle } = fixture();
    const output = run(bundle).lines.join('\n');
    expect(output).toContain(NO_EXTERNAL_KEYS_WARNING);
    expect(output).toContain('from the bundle');
  });

  it('uses an expected key list instead, and then does not warn', () => {
    const { bundle, keys } = fixture();
    const result = run(bundle, { expectedKeys: keys, keysPath: 'adgate-keys.json' });
    const output = result.lines.join('\n');

    expect(output).not.toContain(NO_EXTERNAL_KEYS_WARNING);
    expect(output).toContain('from adgate-keys.json');
    expect(result.code).toBe(EXIT_OK);
  });

  it('fails when the expected keys are not the ones the bundle was signed with', () => {
    const { bundle, signing } = fixture();
    const other = signingKey();
    const result = run(bundle, {
      expectedKeys: { [signing.key_id]: derivePublicPem(other.private_pem) },
      keysPath: 'rotated-keys.json',
    });
    const output = result.lines.join('\n');

    expect(output).toContain('NOTE');
    expect(output).toContain('is NOT the one in the expected key list');
    expect(output).toContain('FAILED');
    expect(result.code).toBe(EXIT_INVALID);
  });

  it('notes a key the expected list does not mention at all', () => {
    const { bundle } = fixture();
    const other = signingKey();
    const result = run(bundle, {
      expectedKeys: { k_published_elsewhere: derivePublicPem(other.private_pem) },
      keysPath: 'published-keys.json',
    });
    expect(result.lines.join('\n')).toContain('the expected key list does not contain');
    expect(result.code).toBe(EXIT_INVALID);
  });

  it('refuses a record that names another key when --key-id was given', () => {
    const { bundle } = fixture();
    expect(run(bundle, { expectedKeyId: 'k_not_this_one' }).code).toBe(EXIT_INVALID);
    expect(run(bundle, { expectedKeyId: 'k_not_this_one' }).lines.join('\n')).toContain('key_id');
  });

  it('accepts the key id the records really name', () => {
    const { bundle, signing } = fixture();
    expect(run(bundle, { expectedKeyId: signing.key_id }).code).toBe(EXIT_OK);
  });

  it('treats a bundle with no records as its own outcome, not as PASS', () => {
    const { bundle } = fixture();
    const result = run({ ...bundle, records: [] });
    expect(result.lines.join('\n')).toContain('RESULT: EMPTY');
    expect(result.lines.join('\n')).not.toContain('RESULT: PASS');
    expect(result.code).toBe(EXIT_EMPTY);
    expect(result.code).not.toBe(EXIT_OK);
  });

  it('reports both timestamps', () => {
    const { bundle } = fixture();
    const output = run(bundle).lines.join('\n');
    expect(output).toContain('generated   2026-06-02T00:00:00.000Z');
    expect(output).toContain('collected   2026-06-09T00:00:00.000Z');
  });

  it('says how many supporting records are references rather than documents', () => {
    const { bundle } = fixture();
    expect(run(bundle).lines.join('\n')).toContain('3 supporting (2 chain references only)');
  });
});

describe('the creative content the bundle does carry', () => {
  it('is the reported advertiser’s own, and recomputes its content_hash', () => {
    const { bundle } = fixture();
    const creative = bundle.creatives[0];
    expect(creative?.id).toBe(FIXTURE_CANDIDATE.id);
    expect(creativeContentHash(creative!)).toBe(creativeContentHash(FIXTURE_CANDIDATE));
  });
});

describe('parseBundleArgs', () => {
  it('reads the file, the key file and the key id', () => {
    expect(parseBundleArgs(['b.json', '--keys', 'k.json', '--key-id', 'k_1'])).toEqual({
      path: 'b.json',
      keysPath: 'k.json',
      keyId: 'k_1',
      error: null,
    });
  });

  it('refuses what it does not understand instead of ignoring it', () => {
    expect(parseBundleArgs(['b.json', '--trust-me']).error).toContain('unknown option');
    expect(parseBundleArgs(['b.json', '--keys']).error).toContain('needs a value');
    expect(parseBundleArgs(['b.json', '--keys', '--key-id']).error).toContain('needs a value');
    expect(parseBundleArgs(['a.json', 'b.json']).error).toContain('exactly one');
  });

  it('is empty with no arguments at all', () => {
    expect(parseBundleArgs([])).toEqual({ path: null, keysPath: null, keyId: null, error: null });
  });
});
