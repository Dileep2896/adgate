import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The frame the three credential screens share: sign in, sign up, and the operator's break-glass
 * form. One centred column, the wordmark, a title, one line of lede, the card, and a footer line
 * that carries the alternate route plus the theme control.
 *
 * WHY ONE COMPONENT. These are the only pages a stranger ever sees, and three hand-built
 * variations of the same 40 lines is exactly how a design system starts to drift. The variation
 * that matters - which fields, which copy, where the other link goes - is passed in.
 *
 * The theme toggle is here as well as in the rail: somebody who has not signed in yet still has
 * a preference, and the choice is stored before a session exists (lib/theme.ts).
 */

export interface AuthCardProps {
  title: string;
  lede: ReactNode;
  /** The form itself, including its submit button. */
  children: ReactNode;
  /** One line under the card: where to go instead. */
  aside?: ReactNode;
  /** Rendered above the form fields when something went wrong. */
  error?: string | undefined;
  errorTestId?: string;
}

export const AuthCard = ({
  title,
  lede,
  children,
  aside,
  error,
  errorTestId = 'login-error',
}: AuthCardProps) => (
  <main className="grid min-h-dvh place-items-center px-4 py-10">
    <div className="w-full max-w-sm">
      <p className="ag-wordmark">
        adgate<span className="ag-wordmark-mark">.</span>
      </p>
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      <p className="ag-prose mt-1 mb-5 text-xs">{lede}</p>

      {error === undefined ? null : (
        <p id="auth-error" role="alert" data-testid={errorTestId} className="ag-field-error mb-3">
          {error}
        </p>
      )}

      {children}

      <div className="ag-meta mt-5 justify-between">
        <span>{aside}</span>
        <ThemeToggle />
      </div>
    </div>
  </main>
);
