// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CHAIN_INTEGRITY_CHECKS,
  computeReport,
  type ReportDocument,
  type ReportRecordInput,
} from '@/lib/report';
import { fixtureInput, invalidWith } from '@/lib/report-fixture';

import { ReportTables } from './report-tables';

/**
 * The chain-integrity table must state the checks the REPORT measured, not a list typed into a
 * component. chain_integrity is six of docs/audit.md's eight checks (lib/report-document.ts):
 * an empty state naming all eight would tell an advertiser that disclosure and separation were
 * part of the verdict when they are the report's own two percentages.
 */

const document = (records: readonly ReportRecordInput[]): ReportDocument =>
  computeReport({
    advertiser: { id: 'adv_x', name: 'Fixture Co', domain: 'fixture.example' },
    period: { start: '2026-09-01T00:00:00.000Z', end: '2026-09-08T00:00:00.000Z' },
    generatedAt: '2026-09-08T00:00:00.000Z',
    records,
    truncated: false,
    recordLimit: 2000,
  });

const VERIFIED = [
  fixtureInput({ id: 'aud_a', appId: 'app_alpha' }),
  fixtureInput({ id: 'aud_b', appId: 'app_alpha' }),
];

afterEach(cleanup);

describe('the chain integrity table', () => {
  it('names the checks the report measured, and only those', () => {
    const report = document(VERIFIED);
    render(<ReportTables report={report} />);

    const table = screen.getByTestId('report-failures');
    for (const check of CHAIN_INTEGRITY_CHECKS) {
      expect(table.textContent).toContain(check);
    }
    // The two the report states separately: counting them here would report the same gap twice.
    expect(table.textContent).not.toContain('disclosure_present');
    expect(table.textContent).not.toContain('separation_attested');
    expect(report.chain_integrity.checks).toHaveLength(6);
  });

  it('says there was nothing to verify for an empty period', () => {
    render(<ReportTables report={document([])} />);
    expect(screen.getByTestId('report-failures').textContent).toContain('No records to verify.');
  });

  it('lists a failing record instead of the empty state', () => {
    const report = document([
      ...VERIFIED,
      fixtureInput({
        id: 'aud_broken',
        appId: 'app_beta',
        verification: invalidWith(['record_hash', 'chain']),
      }),
    ]);
    render(<ReportTables report={report} />);

    expect(screen.getAllByTestId('report-failure-row')).toHaveLength(1);
    expect(screen.getByTestId('report-failures').textContent).toContain('record_hash, chain');
  });
});
