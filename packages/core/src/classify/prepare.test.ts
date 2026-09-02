import type { Message } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PREPARE_OPTIONS, prepareText } from './prepare.js';

const msg = (role: Message['role'], content: string): Message => ({ role, content });

describe('prepareText', () => {
  it('defaults to the docs/api.md limits: last 4 messages and 4,000 characters', () => {
    expect(DEFAULT_PREPARE_OPTIONS).toEqual({ maxMessages: 4, maxChars: 4000 });
  });

  it('joins messages as "role: content" lines, newest last', () => {
    const text = prepareText({
      messages: [msg('user', 'hi'), msg('assistant', 'hello'), msg('user', 'which postgres host')],
    });
    expect(text).toBe('user: hi\nassistant: hello\nuser: which postgres host');
  });

  it('keeps only the last maxMessages messages', () => {
    const messages = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((content) => msg('user', content));
    expect(prepareText({ messages })).toBe('user: m3\nuser: m4\nuser: m5\nuser: m6');
    expect(prepareText({ messages }, { maxMessages: 2, maxChars: 4000 })).toBe(
      'user: m5\nuser: m6',
    );
  });

  it('truncates to the last maxChars characters', () => {
    const long = 'a'.repeat(3000) + 'b'.repeat(3000);
    const text = prepareText({ messages: [msg('user', long)] });
    expect(text).toHaveLength(4000);
    expect(text).toBe('a'.repeat(1000) + 'b'.repeat(3000));
    expect(
      prepareText({ messages: [msg('user', 'abcdef')] }, { maxMessages: 4, maxChars: 3 }),
    ).toBe('def');
  });

  it('applies the message limit before the character limit', () => {
    const messages = [msg('user', 'x'.repeat(5000)), msg('assistant', 'short answer')];
    expect(prepareText({ messages }, { maxMessages: 1, maxChars: 4000 })).toBe(
      'assistant: short answer',
    );
  });

  it('counts characters as code points so an emoji is never cut in half', () => {
    const text = prepareText({ context_summary: '😀'.repeat(10) }, { maxMessages: 4, maxChars: 3 });
    expect(text).toBe('😀😀😀');
  });

  it('uses context_summary when there are no messages', () => {
    expect(prepareText({ context_summary: 'user compares managed postgres providers' })).toBe(
      'user compares managed postgres providers',
    );
    expect(prepareText({ messages: [], context_summary: 'summary' })).toBe('summary');
    expect(prepareText({ context_summary: 'x'.repeat(5000) })).toHaveLength(4000);
  });

  it('prefers messages over context_summary when both are present', () => {
    expect(
      prepareText({ messages: [msg('user', 'buy a vpn')], context_summary: 'ignored summary' }),
    ).toBe('user: buy a vpn');
  });

  it('returns an empty string when neither is present', () => {
    expect(prepareText({})).toBe('');
    expect(prepareText({ messages: undefined, context_summary: undefined })).toBe('');
  });

  it('does not mutate the input', () => {
    const messages = ['m1', 'm2', 'm3', 'm4', 'm5'].map((content) => msg('user', content));
    const input = { messages };
    prepareText(input);
    expect(input.messages).toHaveLength(5);
    expect(input.messages[0]).toEqual(msg('user', 'm1'));
  });
});
