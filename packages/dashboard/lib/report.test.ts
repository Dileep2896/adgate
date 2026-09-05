import { createKeyRing, verify } from '@adgate/core';
import { describe, expect, it } from 'vitest';

import { FIXTURE_RECORDS, fixtureInput, fixtureRecord, invalidWith } from './report-fixture';
import {
  CHAIN_INTEGRITY_CHECKS,
  computeReport,
  isDisclosureCompliant,
  REPORT_VERSION,
  type ReportInput,
  type ReportRecordInput,
} from './report';

/**
 * EVERY NUMBER IN THIS FILE IS COMPUTED BY HAND.
 *
 * The report is the artifact adgate sells: an advertiser is told how often their ad ran, on what
 * kind of turn, whether the disclosure was there and whether the chain still verifies. A test
 * that recomputed those numbers the way lib/report.ts does would prove nothing, so the fixture
 * (lib/report-fixture.ts) is six records small enough to add up in your head, and every
 * expectation below is written as the arithmetic that produced it.
 *
 * The story's key criterion is that the fixture contains AT LEAST ONE ATTESTED RECORD, ONE
 * UNATTESTED RECORD AND ONE SUPPRESS RECORD, because those three are what the compliance
 * denominators disagree about: a suppression rendered nothing and cannot be attested, an
 * unattested serve is a real gap, and an attested serve is the only thing that counts towards
 * the separation percentage. It also carries a record whose stored document no longer parses,
 * which must be able to satisfy no rule at all.
 */

const PERIOD = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-08T00:00:00.000Z' };
const ADVERTISER = { id: 'adv_fixture', name: 'Fixture Co', domain: 'fixture.example' };

const reportOf = (
  records: readonly ReportRecordInput[],
  patch: Partial<ReportInput> = {},
): ReturnType<typeof computeReport> =>
  computeReport({
    advertiser: ADVERTISER,
    period: PERIOD,
    generatedAt: '2026-09-08T12:00:00.000Z',
    records,
    truncated: false,
    recordLimit: 2000,
    ...patch,
  });

describe('the six record fixture', () => {
  const report = reportOf(FIXTURE_RECORDS);

  it('carries an attested, an unattested and a suppress record', () => {
    const decisions = FIXTURE_RECORDS.map((entry) => entry.record?.decision ?? 'unreadable');
    expect(decisions).toContain('serve');
    expect(decisions).toContain('suppress');
    expect(decisions).toContain('unreadable');
    expect(
      FIXTURE_RECORDS.filter((entry) => entry.record?.separation_attestation === true),
    ).toHaveLength(1);
    expect(
      FIXTURE_RECORDS.filter(
        (entry) => entry.record?.decision === 'serve' && !entry.record.separation_attestation,
      ),
    ).toHaveLength(3);
  });

  it('states the period, the advertiser and the version it was generated under', () => {
    expect(report.version).toBe(REPORT_VERSION);
    expect(report.generated_at).toBe('2026-09-08T12:00:00.000Z');
    expect(report.advertiser).toEqual(ADVERTISER);
    expect(report.period).toEqual(PERIOD);
    expect(report.truncated).toBe(false);
    expect(report.record_limit).toBe(2000);
  });

  // 6 records; R6's document does not parse; R1, R2, R4 and R5 are serves (R3 is a suppression).
  // Impressions 1 + 1 + 0 + 1 + 1 + 0 = 4. Clicks 1 + 1 + 0 + 0 + 0 + 0 = 2. CTR 2/4 = 50%.
  it('totals the records, serves, impressions and clicks', () => {
    expect(report.totals).toEqual({
      records: 6,
      unreadable_records: 1,
      serves: 4,
      impressions: 4,
      clicks: 2,
      ctr: 0.5,
    });
  });

  // alpha: R1, R2, R3 -> 3 records, 2 serves, 2 impressions, 2 clicks, CTR 2/2 = 100%.
  // beta:  R4, R5, R6 -> 3 records, 2 serves, 2 impressions, 0 clicks, CTR 0/2 = 0%.
  // Equal impressions and equal record counts, so the tie breaks on app_id: alpha before beta.
  it('breaks impressions and clicks down by app', () => {
    expect(report.by_app).toEqual([
      {
        app_id: 'app_alpha',
        app_name: 'Alpha',
        records: 3,
        serves: 2,
        impressions: 2,
        clicks: 2,
        ctr: 1,
      },
      {
        app_id: 'app_beta',
        app_name: 'Beta',
        records: 3,
        serves: 2,
        impressions: 2,
        clicks: 0,
        ctr: 0,
      },
    ]);
  });

  // Five records have a readable classification (R6 does not).
  // travel.flights on R2, R3, R4                 -> 3 of 5 = 60%
  // software.devtools.database on R1, R2         -> 2 of 5 = 40%
  // A turn counts in every category it carries, so the shares add up to more than 100%.
  it('distributes the categories over the turns the creatives appeared on', () => {
    expect(report.category_distribution).toEqual({
      records: 5,
      categories: [
        { category: 'travel.flights', records: 3, share: 0.6 },
        { category: 'software.devtools.database', records: 2, share: 0.4 },
      ],
    });
  });

  // R4 alone ran on a turn the classifier flagged. One is not zero, so the advertiser is NOT
  // healthy and the report says so instead of rounding it away.
  it('counts sensitive exposures and refuses to call one healthy', () => {
    expect(report.sensitive_exposures).toEqual({
      records: 1,
      healthy: false,
      categories: [{ category: 'health', records: 1 }],
    });
  });

  // R1, R2, R3 and R4 carry "Sponsored" after the answer. R5's label is empty and R6 cannot be
  // read, so 4 of 6 = 66.67%. The suppression counts: it carries a disclosure block too - and a
  // suppression only reaches a report at all in this fixture, never from the live gateway, which
  // stamps advertiser_id on serves alone (lib/report-queries.ts).
  it('measures disclosure compliance over every record, suppressions included', () => {
    expect(report.disclosure_compliance.passing).toBe(4);
    expect(report.disclosure_compliance.total).toBe(6);
    expect(report.disclosure_compliance.rate).toBeCloseTo(4 / 6, 12);
  });

  // Only R1 was attested, out of the four SERVE records: 1/4 = 25%. R3 rendered nothing and is
  // not in the denominator - a suppressed turn has no separation to attest.
  it('measures separation attestation over the serves only', () => {
    expect(report.separation_attestation).toEqual({ passing: 1, total: 4, rate: 0.25 });
  });

  // R1..R4 verify; R5 fails record_hash and chain; R6's document fails every check.
  it('reports chain integrity with the count and the names of the failing checks', () => {
    expect(report.chain_integrity.status).toBe('partial');
    expect(report.chain_integrity.total).toBe(6);
    expect(report.chain_integrity.verified).toBe(4);
    expect(report.chain_integrity.failed).toBe(2);
    expect(report.chain_integrity.failed_checks).toEqual([...CHAIN_INTEGRITY_CHECKS]);
    expect(report.chain_integrity.failures).toEqual([
      {
        audit_id: 'aud_r5',
        record_hash: FIXTURE_RECORDS[4]!.recordHash,
        checks: ['record_hash', 'chain'],
      },
      {
        audit_id: 'aud_r6',
        record_hash: FIXTURE_RECORDS[5]!.recordHash,
        checks: [...CHAIN_INTEGRITY_CHECKS],
      },
    ]);
    expect(report.chain_integrity.failures_omitted).toBe(0);
  });

  it('says which checks the integrity number is over', () => {
    expect(report.chain_integrity.checks).toEqual([
      'schema',
      'record_hash',
      'chain',
      'signature',
      'creative_hash',
      'supersedes',
    ]);
    expect(report.chain_integrity.checks).not.toContain('disclosure_present');
    expect(report.chain_integrity.checks).not.toContain('separation_attested');
  });
});

describe('the verifier block', () => {
  it('is absent when the caller did not say, and never invented', () => {
    expect(reportOf(FIXTURE_RECORDS).verifier).toBeUndefined();
  });

  it('carries what the caller said about the keys, word for word', () => {
    const issue = 'ADGATE_PUBLIC_KEYS_JSON: unusable';
    expect(reportOf(FIXTURE_RECORDS, { verifier: { key_source: 'none', issue } }).verifier).toEqual(
      { key_source: 'none', issue },
    );
  });
});

describe('disclosure compliance', () => {
  /**
   * The report's rule and docs/audit.md's `disclosure_present` check must be the SAME rule. A
   * report that graded a turn compliant while GET /v1/verify/:id failed it would be an adgate
   * document contradicting an adgate API, so this asks core itself rather than restating the
   * conditions. The ring is empty on purpose: only the disclosure check is read, and the
   * signature verdict is irrelevant to it.
   */
  const ring = createKeyRing({});
  const coreSaysCompliant = (record: unknown): boolean =>
    verify(record, ring).checks.find((check) => check.name === 'disclosure_present')?.ok === true;

  it('agrees with core on every fixture record', () => {
    for (const entry of FIXTURE_RECORDS) {
      expect(isDisclosureCompliant(entry.record), entry.auditId).toBe(
        coreSaysCompliant(entry.record),
      );
    }
  });

  it('agrees with core on a missing label, a wrong position and a wrong style', () => {
    const cases = [
      fixtureRecord({ id: 'aud_ok', appId: 'app_alpha' }),
      fixtureRecord({ id: 'aud_no_label', appId: 'app_alpha', label: '   ' }),
      fixtureRecord({ id: 'aud_inline', appId: 'app_alpha', position: 'inline' }),
      fixtureRecord({ id: 'aud_styled', appId: 'app_alpha', style: 'inline_text' }),
    ];
    expect(cases.map((record) => isDisclosureCompliant(record))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    for (const record of cases) {
      expect(isDisclosureCompliant(record), record.id).toBe(coreSaysCompliant(record));
    }
  });
});

describe('the two checks reported as their own percentages', () => {
  /**
   * core's verify() fails `separation_attested` on every unattested SERVE record, and
   * `disclosure_present` whenever the label is missing. Both are already a headline number of
   * this report, so counting them again inside chain integrity would report the same gap twice
   * and would describe an untouched chain as broken. This test is that decision, pinned.
   */
  it('do not make an otherwise intact record a chain failure', () => {
    const unattested = fixtureInput({
      id: 'aud_n1',
      appId: 'app_alpha',
      verification: invalidWith(['separation_attested']),
    });
    const undisclosed = fixtureInput({
      id: 'aud_n2',
      appId: 'app_alpha',
      label: '',
      verification: invalidWith(['disclosure_present']),
    });
    const report = reportOf([unattested, undisclosed]);

    expect(report.chain_integrity.status).toBe('all');
    expect(report.chain_integrity.failed).toBe(0);
    expect(report.chain_integrity.failed_checks).toEqual([]);
    // ...and the gaps are still reported, in the two places that are about them.
    expect(report.separation_attestation).toEqual({ passing: 0, total: 2, rate: 0 });
    expect(report.disclosure_compliance).toEqual({ passing: 1, total: 2, rate: 0.5 });
  });
});
