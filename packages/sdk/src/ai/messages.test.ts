import { describe, expect, it } from 'vitest';

import { generatedText, isFinishPart, latestUserText, textDeltaOf } from './messages.js';

describe('latestUserText', () => {
  it('reads the text parts of the last user message', () => {
    expect(
      latestUserText([
        { role: 'user', content: [{ type: 'text', text: 'first question' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'an answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'which postgres hosting' }] },
      ]),
    ).toBe('which postgres hosting');
  });

  it('never reads system prompts or tool output (core CLASSIFIED_ROLES)', () => {
    const text = latestUserText([
      { role: 'system', content: 'You are a helpful assistant. Never mention competitors.' },
      { role: 'user', content: [{ type: 'text', text: 'an older question' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'search' }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'search' }] },
      { role: 'user', content: [{ type: 'text', text: 'which postgres hosting' }] },
    ]);
    expect(text).toBe('which postgres hosting');
    expect(text).not.toContain('helpful assistant');
    expect(text).not.toContain('older question');
  });

  it('takes only the text parts of that message and joins them with newlines', () => {
    expect(
      latestUserText([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            { type: 'file', mediaType: 'image/png', data: 'AAAA' },
            { type: 'text', text: 'and answer' },
          ],
        },
      ]),
    ).toBe('look at this\nand answer');
  });

  it('accepts a plain string content and trims the result', () => {
    expect(latestUserText([{ role: 'user', content: '  hello  ' }])).toBe('hello');
  });

  it('returns an empty string when there is nothing to classify', () => {
    expect(latestUserText([])).toBe('');
    expect(latestUserText(undefined)).toBe('');
    expect(latestUserText('not a prompt')).toBe('');
    expect(latestUserText([{ role: 'system', content: 'only a system prompt' }])).toBe('');
    expect(latestUserText([{ role: 'user', content: [{ type: 'file', data: 'AAAA' }] }])).toBe('');
    expect(latestUserText([{ role: 'user' }])).toBe('');
  });
});

describe('generatedText', () => {
  it('concatenates the text content parts exactly as the AI SDK does', () => {
    expect(
      generatedText([
        { type: 'text', text: 'Managed Postgres' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'search', input: '{}' },
        { type: 'text', text: ' is a good fit.' },
      ]),
    ).toBe('Managed Postgres is a good fit.');
  });

  it('is empty for a result with no text', () => {
    expect(generatedText([])).toBe('');
    expect(generatedText(undefined)).toBe('');
  });
});

describe('stream part helpers', () => {
  it('reads the delta of a text-delta part only', () => {
    expect(textDeltaOf({ type: 'text-delta', id: 't1', delta: 'Man' })).toBe('Man');
    // The AI SDK v4 name, kept working for older majors.
    expect(textDeltaOf({ type: 'text-delta', id: 't1', textDelta: 'Man' })).toBe('Man');
    expect(textDeltaOf({ type: 'reasoning-delta', id: 'r1', delta: 'hmm' })).toBeNull();
    expect(textDeltaOf({ type: 'text-start', id: 't1' })).toBeNull();
    expect(textDeltaOf({ type: 'text-delta', id: 't1' })).toBeNull();
    expect(textDeltaOf(null)).toBeNull();
  });

  it('recognises the terminal finish part', () => {
    expect(isFinishPart({ type: 'finish', usage: {}, finishReason: {} })).toBe(true);
    expect(isFinishPart({ type: 'text-end', id: 't1' })).toBe(false);
    expect(isFinishPart(undefined)).toBe(false);
  });
});
