'use client';

import { useState } from 'react';

/**
 * Copies a value the page is already showing (a policy hash, an app id, an API key). The value
 * never leaves the browser: this is navigator.clipboard, not a request.
 *
 * The clipboard API needs a secure context, which http://localhost and https both are; if it
 * is missing or the user denies it, the button says so instead of pretending it worked. The
 * full value is always selectable on the page too, so copying is never the only way to get it.
 *
 * Success is quiet and lives in the button itself - the label becomes "Copied" for a moment
 * and the surface goes green - rather than in a toast. The operator can see the value they
 * just copied; a floating congratulation would be noise. `data-state` drives the success and
 * error styling from the shared control system in app/globals.css.
 */

export interface CopyButtonProps {
  value: string;
  /** Button text. Keep it short; it sits next to the value. */
  label?: string;
  /** For tests and for telling several copy buttons apart. */
  testId?: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

const TEXT: Record<CopyState, string> = { idle: '', copied: 'Copied', failed: 'Press Ctrl+C' };

const DATA_STATE: Record<CopyState, string | undefined> = {
  idle: undefined,
  copied: 'success',
  failed: 'error',
};

export const CopyButton = ({ value, label = 'Copy', testId }: CopyButtonProps) => {
  const [state, setState] = useState<CopyState>('idle');

  const copy = (): void => {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard === undefined) {
      setState('failed');
      return;
    }
    clipboard.writeText(value).then(
      () => {
        setState('copied');
        globalThis.setTimeout(() => {
          setState('idle');
        }, 1500);
      },
      () => {
        setState('failed');
      },
    );
  };

  return (
    <button
      type="button"
      onClick={copy}
      data-testid={testId}
      data-state={DATA_STATE[state]}
      className="ag-btn ag-btn-xs"
    >
      {state === 'idle' ? label : TEXT[state]}
    </button>
  );
};
