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
    <div className="ag-section-head">
      <h2 className="ag-section-title">{title}</h2>
      {hint === undefined ? null : <p className="ag-section-hint">{hint}</p>}
    </div>
    {children}
  </section>
);

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="ag-table-scroll">
    <table className="ag-table">
      <thead>
        <tr>
          {head.map((label) => (
            <th key={label} scope="col" className="table-head">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

/**
 * A report's tables keep their empty row rather than being replaced by a panel: this is a
 * printed document with a fixed shape, and "no records in this period" belongs inside the
 * table it is about, where a reader comparing two reports will look for it.
 */
const Empty = ({ columns, children }: { columns: number; children: ReactNode }) => (
  <tr>
    <td colSpan={columns} className="table-cell">
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
                <span className="table-cell-strong">{row.app_name ?? 'Unknown app'}</span>
                <span className="ag-mono-2xs ml-2">{row.app_id}</span>
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
              <td className="table-cell ag-mono-2xs">{row.category}</td>
              <td className="table-cell">{formatCount(row.records)}</td>
              <td className="table-cell">{formatPercent(row.share)}</td>
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
              <td className="table-cell ag-mono-2xs">{row.category}</td>
              <td className="table-cell">{formatCount(row.records)}</td>
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
              : // The checks the document says the number is over, never a hardcoded list: chain
                // integrity is six of docs/audit.md's eight checks (lib/report-document.ts), and
                // naming the other two here would claim more than the report measured.
                `Every record verified: ${report.chain_integrity.checks.join(', ')}.`}
          </Empty>
        ) : (
          report.chain_integrity.failures.map((row) => (
            <tr key={row.record_hash} data-testid="report-failure-row">
              <td className="table-cell ag-mono-2xs">{row.audit_id}</td>
              <td className="table-cell ag-text-danger">{row.checks.join(', ')}</td>
              <td className="table-cell text-xs">{describeCheck(row.checks[0] ?? '')}</td>
            </tr>
          ))
        )}
      </Table>
      {report.chain_integrity.failures_omitted > 0 ? (
        <p className="ag-hint">
          {formatCount(report.chain_integrity.failures_omitted)} further failing records are not
          listed; the JSON bundle carries every record.
        </p>
      ) : null}
    </Section>
  </div>
);
