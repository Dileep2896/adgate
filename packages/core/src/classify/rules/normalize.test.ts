import { describe, expect, it } from 'vitest';

import { ALIASES } from './data/aliases.js';
import { containsPhrase } from './match.js';
import { normalizeText } from './normalize.js';

describe('normalizeText', () => {
  it('lowercases', () => {
    expect(normalizeText('Best VPN For Public WiFi')).toBe('best vpn for public wifi');
  });

  it('applies Unicode NFKC so fullwidth and ligature forms match plain ASCII', () => {
    expect(normalizeText('ｉｂｕｐｒｏｆｅｎ')).toBe('ibuprofen');
    expect(normalizeText('ﬁle')).toBe('file');
  });

  it('turns punctuation into spaces and keeps digits', () => {
    expect(normalizeText('accessories for an AR-15?')).toBe('accessories for an ar 15');
    expect(normalizeText('Next.js on Vercel/Netlify!')).toBe('next js on vercel netlify');
    expect(normalizeText('under $200 (usd)')).toBe('under 200 usd');
    expect(normalizeText('fix this regex, ^\\d+$ is broken')).toBe('fix this regex d is broken');
    expect(normalizeText('self_harm')).toBe('self harm');
  });

  it('deletes apostrophes so contractions become one token, then expands them', () => {
    expect(normalizeText("I don't want to be here")).toBe('i do not want to be here');
    expect(normalizeText('I’ve had chest pain')).toBe('i have had chest pain');
    expect(normalizeText("my landlord's rights")).toBe('my landlords rights');
    expect(normalizeText("can't stop")).toBe('can not stop');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeText('  chest \t\n pain  ')).toBe('chest pain');
    expect(normalizeText('')).toBe('');
    expect(normalizeText('!!! ...')).toBe('');
  });

  it('applies aliases to whole tokens only', () => {
    expect(normalizeText('buy BTC now')).toBe('buy bitcoin now');
    expect(normalizeText('btcx is not bitcoin')).toBe('btcx is not bitcoin');
    expect(normalizeText('ibuprofin dose')).toBe('ibuprofen dose');
    expect(normalizeText('PostgreSQL vs. MySQL')).toBe('postgres vs mysql');
  });

  it('keeps multi-word phrases contiguous after aliasing', () => {
    const normalized = normalizeText("I don't wanna be here anymore");
    expect(containsPhrase(normalized, 'do not want to be here')).toBe(true);
  });

  it('strips emoji and keeps letters with diacritics', () => {
    expect(normalizeText('best 🎧 headphones')).toBe('best headphones');
    expect(normalizeText('café')).toBe('café');
  });

  it('does not treat prototype property names as aliases', () => {
    expect(normalizeText('constructor toString __proto__')).toBe('constructor tostring proto');
  });
});

describe('ALIASES', () => {
  const entries = Object.entries(ALIASES);

  it('has entries', () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it.each(entries)('maps %s to %s inside a sentence', (from, to) => {
    expect(normalizeText(`x ${from} y`)).toBe(`x ${to} y`);
    expect(normalizeText(from.toUpperCase())).toBe(to);
  });

  it('keys are single normalized tokens and targets are final (never re-aliased)', () => {
    for (const [from, to] of entries) {
      expect(from, `alias key ${from}`).toMatch(/^[a-z0-9]+$/);
      expect(to, `alias target ${to}`).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
      expect(from).not.toBe(to);
      for (const token of to.split(' ')) {
        expect(Object.hasOwn(ALIASES, token), `target token ${token} of ${from} is a key`).toBe(
          false,
        );
      }
    }
  });
});

describe('containsPhrase', () => {
  it('matches whole words only, including multi-word phrases', () => {
    expect(containsPhrase('best ci service', 'ci')).toBe(true);
    expect(containsPhrase('circleci is slow', 'ci')).toBe(false);
    expect(containsPhrase('chest pain', 'chest pain')).toBe(true);
    expect(containsPhrase('i have had chest pain on and off', 'chest pain')).toBe(true);
    expect(containsPhrase('chest and pain', 'chest pain')).toBe(false);
    expect(containsPhrase('', 'ci')).toBe(false);
  });
});
