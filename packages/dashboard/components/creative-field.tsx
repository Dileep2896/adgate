'use client';

import type { ReactNode } from 'react';

import {
  type CreativeField as CreativeFieldName,
  type CreativeFieldIssue,
  issuesForField,
} from '@/lib/creative-issue';

/**
 * One labelled input of the creative editor with its errors underneath it. Field-level, not a
 * list at the top of the form: "eCPM cannot be negative" belongs next to the eCPM box.
 *
 * Client side, so it may only import lib/creative-issue.ts (no imports of its own). The issues
 * it renders are produced on the server by lib/creative-fields.ts.
 */

export const INPUT = 'ag-input mt-1';
export const MONO_INPUT = `${INPUT} ag-input-mono`;

export interface FieldProps {
  id: string;
  label: string;
  field: CreativeFieldName;
  issues: readonly CreativeFieldIssue[];
  hint?: ReactNode;
  children: ReactNode;
}

export const Field = ({ id, label, field, issues, hint, children }: FieldProps) => {
  const mine = issuesForField(issues, field);
  const invalid = mine.length > 0;
  return (
    // data-invalid is set on the WRAPPER and the [data-invalid] .ag-input selector in
    // app/globals.css colours whatever control is inside it, so every kind of field - input,
    // textarea, select - picks up the error border without each call site passing a flag.
    <div data-invalid={invalid ? 'true' : undefined}>
      <label htmlFor={id} className="ag-label-plain">
        {label}
      </label>
      {children}
      {/* ONE note slot, and it keeps a line of height whether or not anything is in it. The
          error REPLACES the hint rather than sitting beside it: two lines of guidance under
          one input is where a form starts jumping around while it is being corrected, and a
          slot that appears from nothing moves every field below it. */}
      <div className="ag-field-note">
        {invalid
          ? mine.map((issue) => (
              <p key={issue.message} data-testid={`issue-${field}`} className="ag-field-error">
                <span aria-hidden="true">&#9888;&#xFE0E;</span> {issue.message}
              </p>
            ))
          : hint}
      </div>
    </div>
  );
};
