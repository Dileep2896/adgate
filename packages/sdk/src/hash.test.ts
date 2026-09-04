import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CLIENT_FAILURE_PROMPT_SEED,
  CLIENT_FAILURE_PROMPT_VERSION,
  hashModelOutput,
} from './hash.js';

/** The same digest the gateway computes with @adgate/core's sha256Prefixed (node:crypto). */
const nodeSha256 = (text: string): string =>
  `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

describe('hashModelOutput', () => {
  it.each([
    '',
    'hello',
    'The answer is 42.',
    'héllo wörld – ünïcödé ✓ 🚀',
    'line one\nline two\r\n\ttabbed',
    'a'.repeat(100_000),
  ])('matches node:crypto sha256 over UTF-8 for %j', async (text) => {
    await expect(hashModelOutput(text)).resolves.toBe(nodeSha256(text));
  });

  it('writes the on-the-wire form sha256:<64 lowercase hex digits>', async () => {
    const hash = await hashModelOutput('anything');
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('never returns the text itself', async () => {
    const text = 'a secret model answer';
    const hash = await hashModelOutput(text);
    expect(hash).not.toContain(text);
    expect(hash.length).toBe('sha256:'.length + 64);
  });
});

describe('CLIENT_FAILURE_PROMPT_VERSION', () => {
  it('is the sha256 of the documented seed string, so a client-side failure is recognisable', () => {
    expect(CLIENT_FAILURE_PROMPT_SEED).toBe('adgate-sdk-client-failure');
    expect(CLIENT_FAILURE_PROMPT_VERSION).toBe(nodeSha256(CLIENT_FAILURE_PROMPT_SEED));
  });

  it('agrees with hashModelOutput', async () => {
    await expect(hashModelOutput(CLIENT_FAILURE_PROMPT_SEED)).resolves.toBe(
      CLIENT_FAILURE_PROMPT_VERSION,
    );
  });
});
