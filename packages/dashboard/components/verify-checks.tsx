import type { AuditVerification } from '@/lib/audit-detail';
import { checkVerdict } from '@/lib/verify-labels';

/**
 * The live result of core's verify() for one record: the verdict, then all eight docs/audit.md
 * checks in order with their ok state and detail.
 *
 * A FAILING CHECK IS SPELLED OUT, NOT COLOURED. Red text alone is invisible to a colour-blind
 * operator, in a screenshot pasted into a black and white report, and to anyone scanning
 * quickly - and this is the one screen where missing a failure matters. Every failing row
 * carries the word FAILED, a warning glyph and a filled band; the banner above the table names
 * the failing checks in words.
 */

export interface VerifyChecksProps {
  verification: AuditVerification;
}

export const VerifyChecks = ({ verification }: VerifyChecksProps) => (
  <div data-testid="verification">
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-sm font-semibold text-stone-900">Verification</h2>
      <span className="text-xs text-stone-500">
        run just now against the stored record and its neighbours
      </span>
    </div>

    {verification.valid ? (
      <p
        data-testid="verify-verdict"
        className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
      >
        VALID - all {verification.checks.length} checks passed.
      </p>
    ) : (
      <p
        data-testid="verify-verdict"
        className="rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900"
      >
        INVALID - {verification.failed.length} of {verification.checks.length} checks FAILED:{' '}
        <span className="font-mono">{verification.failed.join(', ')}</span>
      </p>
    )}

    {verification.keyIssue === null ? null : (
      <p
        data-testid="verify-key-issue"
        className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        Signature check is not meaningful: {verification.keyIssue}
      </p>
    )}

    <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
      <table className="w-full border-collapse">
        <thead className="border-b border-stone-200 bg-stone-50">
          <tr>
            <th className="table-head">Check</th>
            <th className="table-head">Result</th>
            <th className="table-head">Detail</th>
            <th className="table-head">What it proves</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {verification.checks.map((check) => (
            <tr
              key={check.name}
              data-testid="verify-check"
              data-check={check.name}
              data-ok={check.ok ? 'true' : 'false'}
              className={check.ok ? undefined : 'bg-red-50'}
            >
              <td className="table-cell font-mono text-xs font-medium text-stone-900">
                {check.name}
              </td>
              <td className="table-cell">
                {check.ok ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    OK
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase">
                    <span aria-hidden="true">&#9888;</span>
                    {checkVerdict(false)}
                  </span>
                )}
              </td>
              <td className="table-cell text-xs">
                {check.detail === '' ? (
                  <span className="text-stone-400">-</span>
                ) : (
                  <span className={check.ok ? 'text-stone-600' : 'font-medium text-red-800'}>
                    {check.detail}
                  </span>
                )}
              </td>
              <td className="table-cell text-xs text-stone-500">{check.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
