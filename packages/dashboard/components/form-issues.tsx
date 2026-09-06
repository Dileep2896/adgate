import { formatPolicyIssue, type PolicyIssueView } from '@/lib/policy-issue';

/**
 * The error block both admin forms show: plain form errors first, then every policy schema
 * issue with the exact message the PolicyConfig schema produced and the path it belongs to.
 * The messages are not rewritten - the operator has to be able to map them onto the document.
 *
 * `data-testid` rather than role="alert": Next's own route announcer is also role=alert, which
 * makes getByRole('alert') ambiguous (S30).
 */

export interface FormIssuesProps {
  errors: readonly string[];
  issues: readonly PolicyIssueView[];
  testId: string;
}

export const FormIssues = ({ errors, issues, testId }: FormIssuesProps) => {
  if (errors.length === 0 && issues.length === 0) {
    return null;
  }
  return (
    <div data-testid={testId} className="ag-note ag-note-danger">
      <p className="ag-note-strong">
        <span aria-hidden="true">&#9888;&#xFE0E;</span>{' '}
        {issues.length > 0 ? 'This policy was not saved.' : 'Nothing was saved.'}
      </p>
      <ul className="ag-list">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
        {issues.map((issue) => (
          <li key={`${issue.path}:${issue.message}`} className="ag-mono-2xs">
            {formatPolicyIssue(issue)}
          </li>
        ))}
      </ul>
    </div>
  );
};
