import type { AuditVerification } from '@/lib/audit-detail';
import { checkVerdict } from '@/lib/verify-labels';

/**
 * The live result of core's verify() for one record: the verdict, then all eight docs/audit.md
 * checks in order with their ok state and detail.
 *
 * A FAILING CHECK IS SPELLED OUT, NOT COLOURED. Red text alone is invisible to a colour-blind
 * operator, in a screenshot pasted into a black and white report, and to anyone scanning
 * quickly - and this is the one screen where missing a failure matters. So a failing row
 * carries FOUR independent signals, any one of which survives on its own: the word FAILED, a
 * warning glyph, a filled band on the whole row, and its detail set in the danger colour at
 * bold weight. The verdict above the table names the failing checks in words, and the print
 * palette keeps all of it legible on a black and white sheet.
 */

export interface VerifyChecksProps {
  verification: AuditVerification;
}

export const VerifyChecks = ({ verification }: VerifyChecksProps) => (
  <div data-testid="verification">
    <div className="ag-section-head">
      <h2 className="ag-section-title">Verification</h2>
      <p className="ag-section-hint">Run just now against the stored record and its neighbours.</p>
    </div>

    {verification.valid ? (
      <p data-testid="verify-verdict" className="ag-note ag-note-ok ag-note-strong">
        VALID - all {verification.checks.length} checks passed.
      </p>
    ) : (
      <p data-testid="verify-verdict" className="ag-note ag-note-danger ag-note-strong">
        <span aria-hidden="true">&#9888;&#xFE0E;</span> INVALID - {verification.failed.length} of{' '}
        {verification.checks.length} checks FAILED:{' '}
        <span className="ag-mono-2xs">{verification.failed.join(', ')}</span>
      </p>
    )}

    {verification.keyIssue === null ? null : (
      <p data-testid="verify-key-issue" className="ag-note ag-note-warn mt-3">
        Signature check is not meaningful: {verification.keyIssue}
      </p>
    )}

    <div className="ag-table-scroll mt-3">
      <table className="ag-table">
        <thead>
          <tr>
            <th scope="col" className="table-head">
              Check
            </th>
            <th scope="col" className="table-head">
              Result
            </th>
            <th scope="col" className="table-head">
              Detail
            </th>
            <th scope="col" className="table-head">
              What it proves
            </th>
          </tr>
        </thead>
        <tbody>
          {verification.checks.map((check) => (
            <tr
              key={check.name}
              data-testid="verify-check"
              data-check={check.name}
              data-ok={check.ok ? 'true' : 'false'}
              className={check.ok ? undefined : 'ag-row-failed'}
            >
              <td className="table-cell ag-mono-2xs table-cell-strong">{check.name}</td>
              <td className="table-cell">
                {check.ok ? (
                  <span className="ag-badge ag-badge-ok">OK</span>
                ) : (
                  <span className="ag-badge ag-badge-danger">
                    <span aria-hidden="true">&#9888;&#xFE0E;</span>
                    {checkVerdict(false)}
                  </span>
                )}
              </td>
              <td className="table-cell text-xs">
                {check.detail === '' ? (
                  <span aria-hidden="true">-</span>
                ) : (
                  <span className={check.ok ? undefined : 'ag-text-danger'}>{check.detail}</span>
                )}
              </td>
              <td className="table-cell text-xs">{check.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
