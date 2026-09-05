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

export const INPUT =
  'mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900';
export const MONO_INPUT = `${INPUT} font-mono text-xs`;

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
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
      {hint === undefined ? null : <p className="mt-1 text-xs text-stone-500">{hint}</p>}
      {mine.map((issue) => (
        <p
          key={issue.message}
          data-testid={`issue-${field}`}
          className="mt-1 text-xs font-medium text-red-700"
        >
          {issue.message}
        </p>
      ))}
    </div>
  );
};
