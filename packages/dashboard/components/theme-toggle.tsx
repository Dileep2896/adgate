'use client';

import { useEffect, useState } from 'react';

import {
  DEFAULT_THEME_CHOICE,
  THEME_CHOICES,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  THEME_TITLES,
  type ThemeChoice,
  themeAttribute,
  themeChoiceFromStorage,
} from '@/lib/theme';

/**
 * Light, Auto, Dark - the three states the design system supports, as three real buttons
 * rather than a two-state switch that cannot express "follow my OS".
 *
 * The choice is written to localStorage and read back by the blocking script in
 * app/layout.tsx on the next load, which is why there is no flash of the wrong palette.
 * This component only has to keep the live document in step.
 *
 * IT RENDERS `system` ON THE SERVER, ALWAYS. localStorage does not exist there, so the
 * first paint marks Auto and the effect below corrects it after mount - a one frame change
 * inside a 10 rem control, never a change of page colour, because the inline script has
 * already set the palette. Reading storage during render instead would be a hydration
 * mismatch on every load where the operator has chosen.
 *
 * Client side, and deliberately importing nothing but lib/theme.ts (which has no imports of
 * its own): anything reaching @adgateio/core from here would ship zod and a YAML parser to
 * every page, because this component is in the shell.
 */
export const ThemeToggle = () => {
  const [choice, setChoice] = useState<ThemeChoice>(DEFAULT_THEME_CHOICE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null;
    try {
      stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
    } catch {
      // Storage can be denied outright (private mode, a locked down profile). The operator
      // still gets a working toggle for this tab; it just will not be remembered.
      stored = null;
    }
    setChoice(themeChoiceFromStorage(stored));
    setReady(true);
  }, []);

  const select = (next: ThemeChoice): void => {
    setChoice(next);
    const attribute = themeAttribute(next);
    const root = globalThis.document?.documentElement;
    if (root !== undefined) {
      if (attribute === null) {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', attribute);
      }
    }
    try {
      if (next === DEFAULT_THEME_CHOICE) {
        globalThis.localStorage?.removeItem(THEME_STORAGE_KEY);
      } else {
        globalThis.localStorage?.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // Nothing to tell the operator: the palette changed, it simply will not persist.
    }
  };

  return (
    <div
      className="ag-theme-toggle no-print"
      role="group"
      aria-label="Colour theme"
      data-testid="theme-toggle"
    >
      {THEME_CHOICES.map((option) => (
        <button
          key={option}
          type="button"
          className="ag-theme-option"
          aria-pressed={choice === option}
          title={THEME_TITLES[option]}
          data-testid={`theme-${option}`}
          // Before the effect runs the control does not yet know what was stored, so it
          // says so rather than inviting a click that would be based on a stale reading.
          aria-busy={ready ? undefined : true}
          onClick={() => {
            select(option);
          }}
        >
          {THEME_LABELS[option]}
        </button>
      ))}
    </div>
  );
};
