import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { canonicalize } from './canonicalize.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../../../fixtures/canonical-json.json', import.meta.url), 'utf8'),
) as { notes: string[]; cases: Array<{ name: string; inputs: unknown[]; expected: string }> };

describe('canonicalize', () => {
  describe('fixtures/canonical-json.json', () => {
    for (const { name, inputs, expected } of fixture.cases) {
      it(name, () => {
        for (const input of inputs) {
          expect(canonicalize(input)).toBe(expected);
        }
      });
    }
  });

  it('emits no insignificant whitespace and parses back to an equal value', () => {
    const value = { b: [1, { d: 'x y', c: null }], a: { z: 1, y: [true, false] } };
    const canonical = canonicalize(value);
    expect(canonical).not.toMatch(/\s(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    expect(JSON.parse(canonical)).toEqual(value);
  });

  it('sorts keys by UTF-16 code unit, so a surrogate pair sorts before U+FB01 (not code point)', () => {
    const emoji = '\u{1F600}';
    const ligature = '\uFB01';
    expect(emoji.codePointAt(0)).toBeGreaterThan(ligature.codePointAt(0) ?? 0);
    expect(canonicalize({ [ligature]: 2, [emoji]: 1, z: 0 })).toBe(
      `{"z":0,"${emoji}":1,"${ligature}":2}`,
    );
    expect(fixture.notes.some((note) => note.includes('UTF-16 code unit'))).toBe(true);
    expect(
      fixture.cases.some((entry) => entry.name.includes('UTF-16 code unit, not code point')),
    ).toBe(true);
  });

  it('is independent of key insertion order at every depth', () => {
    const forward = { a: { b: { c: 1, d: 2 }, e: 3 }, f: 4 };
    const backward = { f: 4, a: { e: 3, b: { d: 2, c: 1 } } };
    expect(canonicalize(forward)).toBe(canonicalize(backward));
  });

  it('drops object properties whose value is undefined', () => {
    expect(canonicalize({ b: undefined, a: 1, c: { d: undefined } })).toBe('{"a":1,"c":{}}');
  });

  it('accepts null-prototype objects', () => {
    const value = Object.create(null) as Record<string, unknown>;
    value['b'] = 1;
    value['a'] = 2;
    expect(canonicalize(value)).toBe('{"a":2,"b":1}');
  });

  it('formats numbers exactly as JSON.stringify does', () => {
    for (const number of [0, -1, 1.5, 1e21, 1e-7, 123456789012345680000, Number.MAX_SAFE_INTEGER]) {
      expect(canonicalize(number)).toBe(JSON.stringify(number));
    }
  });

  it('throws on values that are not JSON instead of altering them', () => {
    expect(() => canonicalize(undefined)).toThrow(TypeError);
    expect(() => canonicalize({ a: Number.NaN })).toThrow(/non-finite number at \$\.a/);
    expect(() => canonicalize([Number.POSITIVE_INFINITY])).toThrow(/non-finite number at \$\[0\]/);
    expect(() => canonicalize([1, undefined])).toThrow(/undefined array element at \$\[1\]/);
    expect(() => canonicalize({ when: new Date(0) })).toThrow(/unsupported object at \$\.when/);
    expect(() => canonicalize(new Map())).toThrow(TypeError);
    expect(() => canonicalize({ n: 10n })).toThrow(/unsupported bigint at \$\.n/);
    expect(() => canonicalize({ f: () => 1 })).toThrow(/unsupported function at \$\.f/);
  });
});
