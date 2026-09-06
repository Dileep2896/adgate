import type { ReactNode } from 'react';

/**
 * What a page says when it has nothing to show. Three beats, in this order, every time:
 *
 *   1. what is missing        "No apps yet."
 *   2. why that matters       "An app is a tenant of this gateway..."
 *   3. the one next thing     [Register an app]  or a command to run
 *
 * A blank table is the failure this component exists to prevent: an operator looking at an
 * empty audit search cannot tell whether the gateway is quiet, the filters are too narrow,
 * or the page is broken - and those three call for three different actions.
 *
 * Presentational and server rendered.
 */

export interface EmptyStateProps {
  /** Beat one. A full sentence, past or present tense, never a shrug. */
  title: string;
  /** Beats two and three in prose. Keep it under three lines. */
  children: ReactNode;
  /** Beat three as controls, when there is a button or a link to press. */
  actions?: ReactNode;
  testId?: string;
}

export const EmptyState = ({ title, children, actions, testId }: EmptyStateProps) => (
  <div className="ag-empty" data-testid={testId}>
    <p className="ag-empty-title">{title}</p>
    <div className="ag-empty-body">{children}</div>
    {actions === undefined ? null : <div className="ag-empty-actions">{actions}</div>}
  </div>
);
