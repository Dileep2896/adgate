import type { ReactNode } from 'react';

import { formatCount, formatPercent } from '@/lib/format';
import type { ReportDocument } from '@/lib/report';
import { describeCheck } from '@/lib/verify-labels';

/**
 * The four tables of a verification report: delivery by app, the category distribution of the
 * turns the creatives appeared on, the sensitive categories an ad was exposed to, and the
 * records that failed verification.
 *
 * Presentational and server rendered; every number arrives already computed (lib/report.ts) and
 * already formatted through lib/format.ts, so nothing here decides what anything means. Each
 * table is wrapped in its own horizontal scroller so a narrow window never makes the page
 * itself scroll sideways.
 */

const Section = ({
  title,
  hint,
  testId,
  children,
}: {
  title: string;
  hint?: string;
  testId: string;
  children: ReactNode;
}) => (
  <section data-testid={testId} className="space-y-2">
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
      {hint === undefined ? null : <p className="text-xs text-stone-500">{hint}</p>}
    </div>
    {children}
  </section>
);

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
    <table className="min-w-full">
      <thead className="border-b border-stone-200 bg-stone-50">
        <tr>
          {head.map((label) => (
            <th key={label} scope="col" className="table-head">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-100">{children}</tbody>
    </table>
  </div>
);

const Empty = ({ columns, children }: { columns: number; children: ReactNode }) => (
  <tr>
    <td colSpan={columns} className="table-cell text-stone-400">
      {children}
    </td>
  </tr>
);

export const ReportTables = ({ report }: { report: ReportDocument }) => (
  <div className="space-y-6">
    <Section
      title="Delivery by app"
      hint="One row per app that ran a creative of this advertiser."
      testId="report-by-app"
    >
      <Table head={['App', 'Records', 'Served', 'Impressions', 'Clicks', 'CTR']}>
        {report.by_app.length === 0 ? (
          <Empty columns={6}>No records in this period.</Empty>
        ) : (
          report.by_app.map((row) => (
            <tr key={row.app_id} data-testid="report-app-row">
              <td className="table-cell">
                <span className="font-medium text-stone-900">{row.app_name ?? 'Unknown app'}</span>
                <span className="ml-2 font-mono text-xs text-stone-400">{row.app_id}</span>
              </td>
              <td className="table-cell tabular-nums">{formatCount(row.records)}</td>
              <td className="table-cell tabular-nums">{formatCount(row.serves)}</td>
              <td className="table-cell tabular-nums">{formatCount(row.impressions)}</td>
              <td className="table-cell tabular-nums">{formatCount(row.clicks)}</td>
              <td className="table-cell tabular-nums">{formatPercent(row.ctr)}</td>
            </tr>
          ))
        )}
      </Table>
    </Section>

    <Section
      title="Category distribution"
      hint={`Over ${formatCount(report.category_distribution.records)} turns. A turn with two categories counts in both.`}
      testId="report-categories"
    >
      <Table head={['Category', 'Turns', 'Share']}>
        {report.category_distribution.categories.length === 0 ? (
          <Empty columns={3}>No categories were recorded on these turns.</Empty>
        ) : (
          report.category_distribution.categories.map((row) => (
            <tr key={row.category} data-testid="report-category-row">
              <td className="table-cell font-mono text-xs">{row.category}</td>
              <td className="table-cell tabular-nums">{formatCount(row.records)}</td>
              <td className="table-cell tabular-nums">{formatPercent(row.share)}</td>
            </tr>
          ))
        )}
      </Table>
    </Section>

    <Section
      title="Sensitive exposures"
      hint="Ads that ran on a turn the classifier flagged. Must be zero."
      testId="report-sensitive-table"
    >
      <Table head={['Sensitive category', 'Records']}>
        {report.sensitive_exposures.categories.length === 0 ? (
          <Empty columns={2}>None. No ad ran on a flagged turn in this period.</Empty>
        ) : (
          report.sensitive_exposures.categories.map((row) => (
            <tr key={row.category} data-testid="report-sensitive-row">
              <td className="table-cell font-mono text-xs">{row.category}</td>
              <td className="table-cell tabular-nums">{formatCount(row.records)}</td>
            </tr>
          ))
        )}
      </Table>
    </Section>

    <Section
      title="Chain integrity"
      hint={`${formatCount(report.chain_integrity.verified)} of ${formatCount(report.chain_integrity.total)} records verified.`}
      testId="report-failures"
    >
      <Table head={['Audit id', 'Failing checks', 'What that means']}>
        {report.chain_integrity.failures.length === 0 ? (
          <Empty columns={3}>
            {report.chain_integrity.status === 'empty'
              ? 'No records to verify.'
              : 'Every record verified: schema, record_hash, chain, signature, creative_hash, disclosure_present, separation_attested and supersedes.'}
          </Empty>
        ) : (
          report.chain_integrity.failures.map((row) => (
            <tr key={row.record_hash} data-testid="report-failure-row">
              <td className="table-cell font-mono text-xs">{row.audit_id}</td>
              <td className="table-cell font-medium text-stone-900">{row.checks.join(', ')}</td>
              <td className="table-cell text-xs text-stone-500">
                {describeCheck(row.checks[0] ?? '')}
              </td>
            </tr>
          ))
        )}
      </Table>
      {report.chain_integrity.failures_omitted > 0 ? (
        <p className="text-xs text-stone-500">
          {formatCount(report.chain_integrity.failures_omitted)} further failing records are not
          listed; the JSON bundle carries every record.
        </p>
      ) : null}
    </Section>
  </div>
);
