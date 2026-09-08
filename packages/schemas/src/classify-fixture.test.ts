import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ClassifyFixture,
  ClassifyFixtureCase,
  ClassifyFixtureMessage,
  fixtureMessages,
} from './classify-fixture.js';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../fixtures/classify-fixtures.json', import.meta.url), 'utf8'),
);

describe('ClassifyFixture', () => {
  it('parses fixtures/classify-fixtures.json', () => {
    const fixture = ClassifyFixture.parse(raw);
    expect(fixture.version).toBe(1);
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(fixture.cases[0]).toEqual({
      id: 's001',
      text: 'what dose of ibuprofen is safe for my 8 year old',
      expect: { sensitive: ['health'], intent_min: 0, intent_max: 0.2 },
    });
  });

  it('gives every multi-turn case a text that is the content of its last user turn', () => {
    const multiTurn = ClassifyFixture.parse(raw).cases.filter((c) => c.messages !== undefined);
    expect(multiTurn.length).toBeGreaterThan(0);
    for (const c of multiTurn) {
      const users = (c.messages ?? []).filter((message) => message.role === 'user');
      expect(users.at(-1)?.content, c.id).toBe(c.text);
      expect(fixtureMessages(c), c.id).toBe(c.messages);
    }
  });

  it('validates sensitive flags and categories_any against the taxonomies', () => {
    const base = { id: 'x1', text: 'hello', expect: { sensitive: [] } };
    expect(ClassifyFixtureCase.safeParse(base).success).toBe(true);
    expect(
      ClassifyFixtureCase.safeParse({ ...base, expect: { sensitive: ['nonsense'] } }).success,
    ).toBe(false);
    expect(
      ClassifyFixtureCase.safeParse({
        ...base,
        expect: { sensitive: [], categories_any: ['software'] },
      }).success,
    ).toBe(false);
    expect(
      ClassifyFixtureCase.safeParse({
        ...base,
        expect: { sensitive: [], categories_any: ['software.devtools.ci'], intent_min: 0.6 },
      }).success,
    ).toBe(true);
  });

  it('accepts messages and requires text to be the last user turn', () => {
    const base = { id: 'x1', expect: { sensitive: [] } };
    const messages = [
      { role: 'user', content: 'my deploy is failing' },
      { role: 'assistant', content: 'the import case does not match the filename' },
      { role: 'user', content: 'where should I host this instead' },
      { role: 'assistant', content: 'a few managed platforms fit that shape' },
    ];
    // The last USER turn, not the last message: a real turn is classified after the answer.
    expect(
      ClassifyFixtureCase.safeParse({
        ...base,
        text: 'where should I host this instead',
        messages,
      }).success,
    ).toBe(true);
    expect(
      ClassifyFixtureCase.safeParse({
        ...base,
        text: 'a few managed platforms fit that shape',
        messages,
      }).success,
    ).toBe(false);
    // One turn is not a conversation, and only the two roles the classifier reads are allowed.
    expect(
      ClassifyFixtureCase.safeParse({ ...base, text: 'hello', messages: messages.slice(0, 1) })
        .success,
    ).toBe(false);
    expect(ClassifyFixtureMessage.safeParse({ role: 'system', content: 'x' }).success).toBe(false);
    expect(ClassifyFixtureMessage.safeParse({ role: 'tool', content: 'x' }).success).toBe(false);
    expect(ClassifyFixtureMessage.safeParse({ role: 'assistant', content: '' }).success).toBe(
      false,
    );
  });

  it('stands a single-turn case in for one user message', () => {
    const single = ClassifyFixtureCase.parse({ id: 'x1', text: 'hi', expect: { sensitive: [] } });
    expect(single.messages).toBeUndefined();
    expect(fixtureMessages(single)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('keeps intent bounds inside [0, 1] and requires a non-empty id and text', () => {
    const base = { id: 'x1', text: 'hello', expect: { sensitive: [] } };
    expect(
      ClassifyFixtureCase.safeParse({ ...base, expect: { sensitive: [], intent_max: 1.5 } })
        .success,
    ).toBe(false);
    expect(ClassifyFixtureCase.safeParse({ ...base, id: '' }).success).toBe(false);
    expect(ClassifyFixtureCase.safeParse({ ...base, text: '' }).success).toBe(false);
  });
});
