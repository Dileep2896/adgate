/**
 * The colour theme contract, in one place because three very different modules have to
 * agree on it: the inline script in app/layout.tsx (which runs before React exists), the
 * toggle in components/theme-toggle.tsx, and tokens.css (which reads the attribute).
 *
 * THREE STATES, ALL FIRST CLASS. `light` and `dark` are explicit operator choices and are
 * stamped on <html data-theme>; `system` is the absence of that attribute, which lets the
 * prefers-color-scheme block in tokens.css decide. "System" is therefore not a fourth
 * palette, it is the default, and clearing the stored value restores it.
 *
 * Pure: no React, no DOM, no environment - which is why the layout can import it on the
 * server and the toggle can import it in the browser without dragging anything along.
 */

export const THEME_STORAGE_KEY = 'adgate-theme';

export const THEME_CHOICES = ['light', 'system', 'dark'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** With nothing stored the operator follows their OS, which is the honest default. */
export const DEFAULT_THEME_CHOICE: ThemeChoice = 'system';

export const isThemeChoice = (value: unknown): value is ThemeChoice =>
  typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);

/**
 * What a raw localStorage read means. Anything unrecognised - a value from an older build,
 * a key someone edited by hand, or null because the operator has never chosen - is
 * `system`, never an error and never a guess at light or dark.
 */
export const themeChoiceFromStorage = (raw: string | null | undefined): ThemeChoice =>
  isThemeChoice(raw) ? raw : DEFAULT_THEME_CHOICE;

/** The `data-theme` value for a choice, or null when the attribute must be removed. */
export const themeAttribute = (choice: ThemeChoice): 'light' | 'dark' | null =>
  choice === 'system' ? null : choice;

/** Short enough for the rail, and unambiguous: "Auto" is the one that tracks the OS. */
export const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'Light',
  system: 'Auto',
  dark: 'Dark',
};

/**
 * THE ONE PLACE A COLOUR IS WRITTEN TWICE, AND THE ONLY PLACE IT CAN BE.
 *
 * `<meta name="theme-color">` paints the browser's own chrome - the address bar on mobile,
 * the title bar of an installed window - and a meta tag cannot read a CSS custom property.
 * So these two are the sRGB rendering of `--color-paper` in each mode, transcribed by hand.
 * lib/theme.test.ts pins tokens.css's two paper values, so changing the palette without
 * changing these fails a test instead of leaving a pale bar over a dark page.
 */
export const PAPER_LIGHT_OKLCH = 'oklch(97.6% 0.005 250)';
export const PAPER_DARK_OKLCH = 'oklch(17.5% 0.014 258)';

/** oklch(97.6% 0.005 250) */
export const THEME_COLOR_LIGHT = '#f4f5f8';
/** oklch(17.5% 0.014 258) */
export const THEME_COLOR_DARK = '#14161d';

export const THEME_TITLES: Record<ThemeChoice, string> = {
  light: 'Always use the light palette',
  system: 'Follow this device’s light or dark setting',
  dark: 'Always use the dark palette',
};
