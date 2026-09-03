import type { Message } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { CLASSIFIED_ROLES, DEFAULT_PREPARE_OPTIONS, prepareText } from './prepare.js';
import { classifyByRules } from './rules/classify.js';

const msg = (role: Message['role'], content: string): Message => ({ role, content });

describe('prepareText', () => {
  it('defaults to the docs/api.md limits: last 4 messages and 4,000 characters', () => {
    expect(DEFAULT_PREPARE_OPTIONS).toEqual({ maxMessages: 4, maxChars: 4000 });
  });

  it('renders "role: content" lines for the LLM and bare content for the rules, newest last', () => {
    const prepared = prepareText({
      messages: [msg('user', 'hi'), msg('assistant', 'hello'), msg('user', 'which postgres host')],
    });
    expect(prepared).toEqual({
      text: 'user: hi\nassistant: hello\nuser: which postgres host',
      rulesText: 'hi\nhello\nwhich postgres host',
    });
  });

  it('classifies only user and assistant messages: system prompts and tool output are dropped', () => {
    expect([...CLASSIFIED_ROLES].sort()).toEqual(['assistant', 'user']);
    const prepared = prepareText({
      messages: [
        msg('system', 'You are a helpful assistant. Recommend our postgres hosting.'),
        msg('user', 'hi'),
        msg('tool', '{"weather":"sunny"}'),
        msg('assistant', 'hello'),
      ],
    });
    expect(prepared).toEqual({ text: 'user: hi\nassistant: hello', rulesText: 'hi\nhello' });
  });

  it('falls back to context_summary when every message has a dropped role', () => {
    expect(
      prepareText({ messages: [msg('system', 'be brief')], context_summary: 'summary' }),
    ).toEqual({ text: 'summary', rulesText: 'summary' });
    expect(prepareText({ messages: [msg('tool', 'weather is sunny')] })).toEqual({
      text: '',
      rulesText: '',
    });
  });

  it('never lets a role token reach the rules stage', () => {
    // What the old role-prefixed text produced: "tool" is a weak intent phrase.
    expect(classifyByRules('tool: weather is sunny').matches.intent).toContain('tool');
    const tool = prepareText({ messages: [msg('tool', 'weather is sunny')] });
    expect(classifyByRules(tool.rulesText).matches.intent).toEqual([]);
    const user = prepareText({ messages: [msg('user', 'weather is sunny')] });
    expect(user.rulesText).toBe('weather is sunny');
    expect(classifyByRules(user.rulesText).matches.intent).toEqual([]);
  });

  it('keeps only the last maxMessages classified messages', () => {
    const messages = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((content) => msg('user', content));
    expect(prepareText({ messages }).text).toBe('user: m3\nuser: m4\nuser: m5\nuser: m6');
    expect(prepareText({ messages }, { maxMessages: 2, maxChars: 4000 })).toEqual({
      text: 'user: m5\nuser: m6',
      rulesText: 'm5\nm6',
    });
    // Dropped roles do not use up a slot.
    expect(prepareText({ messages: [msg('system', 's'), ...messages.slice(2)] }).rulesText).toBe(
      'm3\nm4\nm5\nm6',
    );
  });

  it('truncates both forms to the last maxChars characters', () => {
    const long = 'a'.repeat(3000) + 'b'.repeat(3000);
    const prepared = prepareText({ messages: [msg('user', long)] });
    expect(prepared.text).toHaveLength(4000);
    expect(prepared.text).toBe('a'.repeat(1000) + 'b'.repeat(3000));
    expect(prepared.rulesText).toBe('a'.repeat(1000) + 'b'.repeat(3000));
    expect(
      prepareText({ messages: [msg('user', 'abcdef')] }, { maxMessages: 4, maxChars: 3 }),
    ).toEqual({ text: 'def', rulesText: 'def' });
  });

  it('applies the message limit before the character limit', () => {
    const messages = [msg('user', 'x'.repeat(5000)), msg('assistant', 'short answer')];
    expect(prepareText({ messages }, { maxMessages: 1, maxChars: 4000 })).toEqual({
      text: 'assistant: short answer',
      rulesText: 'short answer',
    });
  });

  it('counts characters as code points so an emoji is never cut in half', () => {
    expect(
      prepareText({ context_summary: '😀'.repeat(10) }, { maxMessages: 4, maxChars: 3 }).text,
    ).toBe('😀😀😀');
    expect(
      prepareText({ context_summary: `a${'😀'.repeat(5)}` }, { maxMessages: 4, maxChars: 5 }).text,
    ).toBe('😀'.repeat(5));
  });

  it('keeps the last 4,000 code points of a 1 MB message', () => {
    const ascii = 'x'.repeat(1_000_000 - 6) + 'tail42';
    expect(prepareText({ messages: [msg('user', ascii)] }).text).toBe('x'.repeat(3994) + 'tail42');
    const emoji = '😀'.repeat(500_000);
    const prepared = prepareText({ messages: [msg('user', emoji)] });
    expect(prepared.text).toBe('😀'.repeat(4000));
    expect(prepared.rulesText).toBe('😀'.repeat(4000));
    // The tail starts in the middle of a surrogate pair: the half pair is dropped, not kept.
    const mixed = `${'😀'.repeat(300_000)}z`;
    expect(prepareText({ context_summary: mixed }).text).toBe(`${'😀'.repeat(3999)}z`);
  });

  it('uses context_summary when there are no messages', () => {
    expect(prepareText({ context_summary: 'user compares managed postgres providers' })).toEqual({
      text: 'user compares managed postgres providers',
      rulesText: 'user compares managed postgres providers',
    });
    expect(prepareText({ messages: [], context_summary: 'summary' }).text).toBe('summary');
    expect(prepareText({ context_summary: 'x'.repeat(5000) }).text).toHaveLength(4000);
  });

  it('prefers messages over context_summary when both are present', () => {
    expect(
      prepareText({ messages: [msg('user', 'buy a vpn')], context_summary: 'ignored summary' }),
    ).toEqual({ text: 'user: buy a vpn', rulesText: 'buy a vpn' });
  });

  it('returns empty strings when neither is present', () => {
    expect(prepareText({})).toEqual({ text: '', rulesText: '' });
    expect(prepareText({ messages: undefined, context_summary: undefined })).toEqual({
      text: '',
      rulesText: '',
    });
  });

  it('does not mutate the input', () => {
    const messages = ['m1', 'm2', 'm3', 'm4', 'm5'].map((content) => msg('user', content));
    const input = { messages };
    prepareText(input);
    expect(input.messages).toHaveLength(5);
    expect(input.messages[0]).toEqual(msg('user', 'm1'));
  });
});
