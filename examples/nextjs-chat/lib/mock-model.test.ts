import { describe, expect, it } from 'vitest';

import {
  answerFor,
  chunksOf,
  createMockModel,
  DEVTOOLS_ANSWER,
  GENERIC_ANSWER,
  HEALTH_ANSWER,
  lastUserText,
} from './mock-model';

/**
 * The offline model is what makes the example runnable with no API key, so the two things the
 * demo depends on are pinned: which canned answer a question gets, and that the streamed chunks
 * reassemble into exactly that answer.
 */

type Prompt = Parameters<typeof answerFor>[0];

const ask = (text: string): Prompt => [{ role: 'user', content: [{ type: 'text', text }] }];

const readStream = async (stream: ReadableStream<{ type: string }>): Promise<{ type: string }[]> => {
  const parts: { type: string }[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return parts;
    }
    parts.push(value);
  }
};

describe('mock model', () => {
  it('reads the last user message only', () => {
    expect(
      lastUserText([
        { role: 'user', content: [{ type: 'text', text: 'FIRST' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'SECOND' }] },
      ]),
    ).toBe('second');
  });

  it('picks the devtools answer for the README question', () => {
    expect(answerFor(ask('which postgres hosting should I use for a side project'))).toBe(
      DEVTOOLS_ANSWER,
    );
  });

  it('picks the health answer for a sensitive question', () => {
    expect(answerFor(ask('I have had a headache for three days, what should I do'))).toBe(
      HEALTH_ANSWER,
    );
  });

  it('falls back to the generic answer', () => {
    expect(answerFor(ask('should I rewrite this in rust'))).toBe(GENERIC_ANSWER);
  });

  it('streams chunks that join back into the answer', async () => {
    const model = createMockModel({ chunkDelayMs: 0 });
    const { stream } = await model.doStream({
      prompt: ask('which postgres hosting should I use for a side project'),
    });
    const parts = await readStream(stream as ReadableStream<{ type: string }>);

    expect(parts[0]?.type).toBe('stream-start');
    expect(parts[parts.length - 1]?.type).toBe('finish');
    const text = parts
      .filter((part): part is { type: 'text-delta'; delta: string } => part.type === 'text-delta')
      .map((part) => part.delta)
      .join('');
    expect(text).toBe(DEVTOOLS_ANSWER);
    expect(chunksOf(DEVTOOLS_ANSWER).join('')).toBe(DEVTOOLS_ANSWER);
  });

  it('generates the same answer without streaming', async () => {
    const model = createMockModel({ chunkDelayMs: 0 });
    const result = await model.doGenerate({ prompt: ask('tell me about postgres') });
    expect(result.content).toEqual([{ type: 'text', text: DEVTOOLS_ANSWER }]);
    expect(result.finishReason.unified).toBe('stop');
  });
});
