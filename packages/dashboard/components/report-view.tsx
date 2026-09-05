import type { ReactNode } from 'react';

import { MetricGrid, type Metric } from '@/components/metric-grid';
import { ReportTables } from '@/components/report-tables';
import { formatCount, formatPercent, formatTimestamp } from '@/lib/format';
import type { ChainIntegrityStatus, ReportDocument } from '@/lib/report';

/**
 * The verification report, rendered for reading and for printing.
 *
 * PRINT IS A FIRST CLASS OUTPUT. This is the artifact an advertiser forwards to a client or
 * files with a media plan, so Cmd+P has to produce something that stands on its own: the shell
 * (nav, footer) and every button carry `no-print` (app/globals.css), and the page repeats the
 * advertiser, the period and the generation time at the top so a printed sheet is not anonymous.
 *
 * A FAILURE IS SPELLED OUT, NOT COLOURED (the S34 rule). Non-zero sensitive exposures and a
 * broken chain are stated in words, with the number, above everything else. This is the one page
 * where a reader skimming must not be able to miss a problem, and colour alone is invisible on a
 * black and white printout - which is exactly how this page will most often be read.
 */

const STATUS_TEXT: Record<ChainIntegrityStatus, string> = {
  all: 'INTACT',
  partial: 'BROKEN',
  none: 'BROKEN',
  empty: 'NO RECORDS',
};

const chainSummary = (report: ReportDocument): string => {
  const { chain_integrity: chain } = report;
  if (chain.status === 'empty') {
    return 'No records were found in this period, so there was nothing to verify.';
  }
  if (chain.status === 'all') {
    return `All ${formatCount(chain.total)} records verify against the signed chain.`;
  }
  return `${formatCount(chain.failed)} of ${formatCount(chain.total)} records failed verification (${chain.failed_checks.join(', ')}).`;
};

const headlineMetrics = (report: ReportDocument): Metric[] => [
  {
    label: 'Records',
    value: formatCount(report.totals.records),
    hint: `${formatCount(report.totals.serves)} served`,
    testId: 'report-records',
  },
  {
    label: 'Impressions',
    value: formatCount(report.totals.impressions),
    hint: 'reported by the SDK',
    testId: 'report-impressions',
  },
  {
    label: 'Clicks',
    value: formatCount(report.totals.clicks),
    testId: 'report-clicks',
  },
  {
    label: 'CTR',
    value: formatPercent(report.totals.ctr),
    hint: `${formatCount(report.totals.clicks)} of ${formatCount(report.totals.impressions)} impressions`,
    testId: 'report-ctr',
  },
  {
    label: 'Disclosure',
    value: formatPercent(report.disclosure_compliance.rate),
    hint: `${formatCount(report.disclosure_compliance.passing)} of ${formatCount(report.disclosure_compliance.total)} records labelled after the answer`,
    testId: 'report-disclosure',
  },
  {
    label: 'Separation attested',
    value: formatPercent(report.separation_attestation.rate),
    hint: `${formatCount(report.separation_attestation.passing)} of ${formatCount(report.separation_attestation.total)} serves`,
    testId: 'report-separation',
  },
  {
    label: 'Sensitive exposures',
    value: formatCount(report.sensitive_exposures.records),
    hint: 'must be zero',
    testId: 'report-sensitive',
  },
  {
    label: 'Chain integrity',
    value: STATUS_TEXT[report.chain_integrity.status],
    hint: `${formatCount(report.chain_integrity.verified)} of ${formatCount(report.chain_integrity.total)} verified`,
    testId: 'report-chain',
  },
];

const Banner = ({ ok, children, testId }: { ok: boolean; children: ReactNode; testId: string }) => (
  <p
    data-testid={testId}
    data-ok={String(ok)}
    className={`rounded-md border px-4 py-3 text-sm ${
      ok
        ? 'border-stone-200 bg-stone-50 text-stone-700'
        : 'border-stone-900 bg-stone-900 text-white'
    }`}
  >
    {children}
  </p>
);

export interface ReportViewProps {
  report: ReportDocument;
  /** The rep_ id, printed with the report so a paper copy can be traced back. */
  reportId: string;
}

export const ReportView = ({ report, reportId }: ReportViewProps) => (
  <article data-testid="report-view" className="space-y-6">
    <header className="space-y-1 border-b border-stone-200 pb-4">
      <h1 className="text-2xl font-semibold tracking-tight" data-testid="report-advertiser">
        {report.advertiser.name}
      </h1>
      <p className="text-sm text-stone-500">
        Verification report for {report.advertiser.domain} -{' '}
        <span data-testid="report-period">
          {formatTimestamp(new Date(report.period.start))} to{' '}
          {formatTimestamp(new Date(report.period.end))}
        </span>
      </p>
      <p className="font-mono text-xs text-stone-400">
        {reportId} - generated {formatTimestamp(new Date(report.generated_at))} by adgate
      </p>
    </header>

    <div className="space-y-2">
      {report.verifier === undefined || report.verifier.issue === null ? null : (
        <Banner ok={false} testId="report-verifier-banner">
          SIGNATURES WERE NOT CHECKED: {report.verifier.issue}. Every record below therefore fails
          the `signature` check, so the chain integrity figure describes this deployment&apos;s
          configuration and not the records. Configure the public keys and generate the report again
          before sending it to anyone.
        </Banner>
      )}
      <Banner ok={report.sensitive_exposures.healthy} testId="report-sensitive-banner">
        {report.sensitive_exposures.healthy
          ? 'No ads ran on a turn the classifier flagged as sensitive.'
          : `WARNING: ${formatCount(report.sensitive_exposures.records)} records ran on a turn the classifier flagged as sensitive. This number must be zero.`}
      </Banner>
      <Banner ok={report.chain_integrity.status === 'all'} testId="report-chain-banner">
        {chainSummary(report)}
      </Banner>
      {report.truncated ? (
        <Banner ok={false} testId="report-truncated-banner">
          PARTIAL REPORT: this period holds more than {formatCount(report.record_limit)} records and
          only the first {formatCount(report.totals.records)} were included.
        </Banner>
      ) : null}
    </div>

    <MetricGrid metrics={headlineMetrics(report)} />

    <ReportTables report={report} />

    <footer className="border-t border-stone-200 pt-4 text-xs text-stone-500">
      <p>
        Every figure above is read from the signed audit records (docs/audit.md), never from a
        summary table. Impressions and clicks are the exception and are reported by the SDK after
        the turn, so they are not covered by a signature. Download the JSON bundle to re-verify
        every record yourself, offline, with the public keys it contains.
      </p>
    </footer>
  </article>
);
