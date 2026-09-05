import { describe, expect, it } from 'vitest';

import { fixtureInput, invalidWith, SCHEMA_INVALID, VALID } from './report-fixture';
import {
  computeReport,
  isDisclosureCompliant,
  MAX_LISTED_FAILURES,
  type ReportInput,
  type ReportRecordInput,
} from './report';
import { VERIFY_CHECK_NAMES } from './verify-labels';

/**
 * The edges of lib/report.ts: a healthy advertiser, an empty period, a period with no serves,
 * a chain that fails everywhere, more failures than the document lists, and a record whose
 * stored document cannot be read. The six-record fixture whose every number is computed by hand
 * is next door in lib/report.test.ts.
 *
 * The rule most of these pin is the zero-denominator one (lib/metrics.ts's, and this module
 * inherits it): a rate over nothing is `null`, never 0%. "No serve was attested" and "there was
 * nothing to attest" are different facts, and a report that printed 0% for both would be
 * accusing an integrator of a gap that does not exist.
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

describe('a healthy advertiser', () => {
  const records = [
    fixtureInput({ id: 'aud_h1', appId: 'app_alpha', attested: true, impressions: 1, clicks: 1 }),
    fixtureInput({ id: 'aud_h2', appId: 'app_alpha', attested: true, impressions: 1 }),
  ];
  const report = reportOf(records);

  it('reports zero sensitive exposures and says it is healthy', () => {
    expect(report.sensitive_exposures.records).toBe(0);
    expect(report.sensitive_exposures.healthy).toBe(true);
    expect(report.sensitive_exposures.categories).toEqual([]);
  });

  it('reports 100% on both compliance rules and a whole chain', () => {
    expect(report.disclosure_compliance.rate).toBe(1);
    expect(report.separation_attestation.rate).toBe(1);
    expect(report.chain_integrity.status).toBe('all');
    expect(report.chain_integrity.failed).toBe(0);
    expect(report.chain_integrity.failed_checks).toEqual([]);
    expect(report.chain_integrity.failures).toEqual([]);
  });
});

describe('an empty period', () => {
  const report = reportOf([]);

  it('is empty rather than perfect', () => {
    expect(report.chain_integrity.status).toBe('empty');
    expect(report.totals.records).toBe(0);
    expect(report.by_app).toEqual([]);
    expect(report.category_distribution.categories).toEqual([]);
  });

  it('leaves every rate unknown, never 0%', () => {
    expect(report.totals.ctr).toBeNull();
    expect(report.disclosure_compliance.rate).toBeNull();
    expect(report.separation_attestation.rate).toBeNull();
  });

  it('still calls zero sensitive exposures healthy', () => {
    expect(report.sensitive_exposures).toEqual({ records: 0, healthy: true, categories: [] });
  });
});

describe('a period with no serves at all', () => {
  const report = reportOf([
    fixtureInput({ id: 'aud_s1', appId: 'app_alpha', decision: 'suppress', reason: 'no_fill' }),
  ]);

  it('leaves the separation rate unknown while disclosure is still measured', () => {
    expect(report.separation_attestation).toEqual({ passing: 0, total: 0, rate: null });
    expect(report.disclosure_compliance).toEqual({ passing: 1, total: 1, rate: 1 });
    expect(report.totals.ctr).toBeNull();
  });
});

describe('a chain that fails everywhere', () => {
  const records = [
    fixtureInput({ id: 'aud_b1', appId: 'app_alpha', verification: invalidWith(['signature']) }),
    fixtureInput({ id: 'aud_b2', appId: 'app_alpha', verification: SCHEMA_INVALID }),
  ];

  it('is reported as none, not partial', () => {
    const report = reportOf(records);
    expect(report.chain_integrity.status).toBe('none');
    expect(report.chain_integrity.verified).toBe(0);
    expect(report.chain_integrity.failed).toBe(2);
  });
});

describe('more failures than the document lists', () => {
  const records = Array.from({ length: MAX_LISTED_FAILURES + 3 }, (_unused, index) =>
    fixtureInput({
      id: `aud_f${String(index)}`,
      appId: 'app_alpha',
      verification: invalidWith(['signature']),
    }),
  );

  it('caps the list and says how many it left out', () => {
    const report = reportOf(records);
    expect(report.chain_integrity.failed).toBe(MAX_LISTED_FAILURES + 3);
    expect(report.chain_integrity.failures).toHaveLength(MAX_LISTED_FAILURES);
    expect(report.chain_integrity.failures_omitted).toBe(3);
    expect(report.chain_integrity.failed_checks).toEqual(['signature']);
  });
});

describe('the truncation flag', () => {
  it('is carried into the document with the limit that produced it', () => {
    const records = [fixtureInput({ id: 'aud_t1', appId: 'app_alpha' })];
    const report = reportOf(records, { truncated: true, recordLimit: 5 });
    expect(report.truncated).toBe(true);
    expect(report.record_limit).toBe(5);
  });
});

describe('the disclosure rule', () => {
  it('needs a non-empty label in the after_answer position', () => {
    const compliant = fixtureInput({ id: 'aud_d1', appId: 'app_alpha' });
    const noLabel = fixtureInput({ id: 'aud_d2', appId: 'app_alpha', label: '   ' });
    const inline = fixtureInput({ id: 'aud_d3', appId: 'app_alpha', position: 'inline' });

    expect(isDisclosureCompliant(compliant.record)).toBe(true);
    expect(isDisclosureCompliant(noLabel.record)).toBe(false);
    expect(isDisclosureCompliant(inline.record)).toBe(false);
    expect(isDisclosureCompliant(null)).toBe(false);
  });
});

describe('a record whose document cannot be read', () => {
  const unreadable = fixtureInput({
    id: 'aud_u1',
    appId: 'app_alpha',
    unreadable: true,
    impressions: 1,
    clicks: 1,
    verification: SCHEMA_INVALID,
  });

  it('is counted, but satisfies nothing', () => {
    const report = reportOf([unreadable]);
    expect(report.totals.records).toBe(1);
    expect(report.totals.unreadable_records).toBe(1);
    expect(report.totals.serves).toBe(0);
    // The events still happened - they are not part of the signed document.
    expect(report.totals.impressions).toBe(1);
    expect(report.disclosure_compliance).toEqual({ passing: 0, total: 1, rate: 0 });
    // It is not a serve, so it cannot silently improve the attestation percentage.
    expect(report.separation_attestation).toEqual({ passing: 0, total: 0, rate: null });
    expect(report.category_distribution.records).toBe(0);
    expect(report.chain_integrity.status).toBe('none');
  });
});

describe('the fixture verification helpers', () => {
  it('agree with docs/audit.md about how many checks there are', () => {
    expect(VALID.checks).toHaveLength(VERIFY_CHECK_NAMES.length);
    expect(VALID.checks.every((check) => check.ok)).toBe(true);
    expect(SCHEMA_INVALID.checks.every((check) => !check.ok)).toBe(true);
  });
});
