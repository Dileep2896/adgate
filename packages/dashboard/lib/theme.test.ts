import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_CHOICE,
  isThemeChoice,
  THEME_CHOICES,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  THEME_TITLES,
  PAPER_DARK_OKLCH,
  PAPER_LIGHT_OKLCH,
  themeAttribute,
  themeChoiceFromStorage,
} from './theme';

/**
 * The theme contract is read by a script that runs before React exists, so it has to be
 * total: every possible localStorage value maps to one of the three choices and nothing
 * throws. A stored value nobody recognises must land on `system` - guessing `dark` for an
 * operator who never asked for it is worse than following their OS.
 */

describe('themeChoiceFromStorage', () => {
  it('keeps a stored choice', () => {
    expect(themeChoiceFromStorage('light')).toBe('light');
    expect(themeChoiceFromStorage('dark')).toBe('dark');
    expect(themeChoiceFromStorage('system')).toBe('system');
  });

  it('falls back to system for anything it does not recognise', () => {
    for (const raw of [null, undefined, '', 'Dark', 'auto', 'sepia', '{}']) {
      expect(themeChoiceFromStorage(raw), String(raw)).toBe(DEFAULT_THEME_CHOICE);
    }
    expect(DEFAULT_THEME_CHOICE).toBe('system');
  });
});

describe('themeAttribute', () => {
  it('is null for system, so the attribute is removed and the OS decides', () => {
    expect(themeAttribute('system')).toBeNull();
  });

  it('is the choice itself for an explicit one', () => {
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
});

describe('the contract itself', () => {
  it('names every choice, and only those', () => {
    expect([...THEME_CHOICES]).toEqual(['light', 'system', 'dark']);
    expect(isThemeChoice('light')).toBe(true);
    expect(isThemeChoice('sepia')).toBe(false);
    expect(isThemeChoice(2)).toBe(false);
  });

  it('labels and describes every choice', () => {
    for (const choice of THEME_CHOICES) {
      expect(THEME_LABELS[choice].length).toBeGreaterThan(0);
      expect(THEME_TITLES[choice].length).toBeGreaterThan(0);
    }
  });

  it('uses the storage key the inline boot script reads', () => {
    expect(THEME_STORAGE_KEY).toBe('adgate-theme');
  });
});

/**
 * `<meta name="theme-color">` cannot read a custom property, so the browser-chrome colours
 * are transcribed from --color-paper by hand (lib/theme.ts). This is the guard on that
 * duplication: change the paper token without changing the transcription and this fails,
 * rather than shipping a pale address bar over a dark page.
 */
describe('the browser chrome colours', () => {
  const tokens = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tokens.css'),
    'utf8',
  );

  it('is transcribed from the paper token this file names', () => {
    expect(tokens).toContain(`--color-paper: ${PAPER_LIGHT_OKLCH};`);
    expect(tokens).toContain(`--color-paper: ${PAPER_DARK_OKLCH};`);
  });

  it('is one opaque hex per mode, and the dark one is the darker', () => {
    for (const value of [THEME_COLOR_LIGHT, THEME_COLOR_DARK]) {
      expect(value, value).toMatch(/^#[0-9a-f]{6}$/);
    }
    const luminance = (hex: string): number =>
      Number.parseInt(hex.slice(1, 3), 16) +
      Number.parseInt(hex.slice(3, 5), 16) +
      Number.parseInt(hex.slice(5, 7), 16);
    expect(luminance(THEME_COLOR_DARK)).toBeLessThan(luminance(THEME_COLOR_LIGHT));
  });
});
