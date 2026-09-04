'use client';

import { useState } from 'react';

/**
 * Copies a value the page is already showing (a policy hash, an app id, an API key). The value
 * never leaves the browser: this is navigator.clipboard, not a request.
 *
 * The clipboard API needs a secure context, which http://localhost and https both are; if it
 * is missing or the user denies it, the button says so instead of pretending it worked. The
 * full value is always selectable on the page too, so copying is never the only way to get it.
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
      className="rounded border border-stone-300 px-1.5 py-0.5 text-xs font-medium text-stone-600 hover:border-stone-400 hover:text-stone-900"
    >
      {state === 'idle' ? label : TEXT[state]}
    </button>
  );
};
