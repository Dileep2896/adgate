import { describe, expect, it } from 'vitest';

import { TEMPLATE_PLACEHOLDERS, fillTemplate } from './template.js';

describe('fillTemplate', () => {
  it('substitutes every placeholder with the URL-encoded value', () => {
    expect(
      fillTemplate('https://t.example/go?pid={{program_id}}&u={{u}}', {
        program_id: 'p 1&x',
        destination: 'https://a.example/?q=1&r=two words',
      }),
    ).toEqual({
      ok: true,
      url: 'https://t.example/go?pid=p%201%26x&u=https%3A%2F%2Fa.example%2F%3Fq%3D1%26r%3Dtwo%20words',
    });
  });

  it('treats u and destination as one value, tolerates spaces in the braces and repeats', () => {
    expect(
      fillTemplate('https://t.example/{{ program_id }}?u={{destination}}&again={{program_id}}', {
        program_id: 'abc',
        destination: 'https://a.example/',
      }),
    ).toEqual({ ok: true, url: 'https://t.example/abc?u=https%3A%2F%2Fa.example%2F&again=abc' });
  });

  it('leaves a template without placeholders untouched', () => {
    expect(fillTemplate('https://t.example/?ref=adgate', {})).toEqual({
      ok: true,
      url: 'https://t.example/?ref=adgate',
    });
  });

  it('fails on a placeholder without a value, naming the first missing one', () => {
    expect(
      fillTemplate('https://t.example/?c={{campaign_id}}&p={{program_id}}', { program_id: 'p' }),
    ).toEqual({ ok: false, error: 'missing_placeholder:campaign_id' });
    expect(fillTemplate('https://t.example/?p={{program_id}}', { program_id: '' })).toEqual({
      ok: false,
      error: 'missing_placeholder:program_id',
    });
    expect(fillTemplate('https://t.example/?u={{u}}', {})).toEqual({
      ok: false,
      error: 'missing_placeholder:u',
    });
  });

  it('fails on an unknown placeholder', () => {
    expect(fillTemplate('https://t.example/?x={{api_key}}', {})).toEqual({
      ok: false,
      error: 'unknown_placeholder:api_key',
    });
    expect(fillTemplate('https://t.example/?x={{}}', {})).toEqual({
      ok: false,
      error: 'unknown_placeholder:',
    });
    expect(TEMPLATE_PLACEHOLDERS).toEqual(['program_id', 'campaign_id', 'tag', 'u', 'destination']);
  });

  it('fails when the result is not an absolute http(s) URL', () => {
    expect(fillTemplate('go?pid={{program_id}}', { program_id: 'p' })).toEqual({
      ok: false,
      error: 'invalid_url',
    });
    expect(fillTemplate('javascript:alert({{program_id}})', { program_id: '1' })).toEqual({
      ok: false,
      error: 'invalid_url',
    });
    expect(fillTemplate('ftp://t.example/{{program_id}}', { program_id: '1' })).toEqual({
      ok: false,
      error: 'invalid_url',
    });
    expect(fillTemplate('', {})).toEqual({ ok: false, error: 'invalid_url' });
  });

  it('fails instead of throwing on a value that cannot be encoded', () => {
    expect(
      fillTemplate('https://t.example/?p={{program_id}}', {
        program_id: String.fromCharCode(0xd800),
      }),
    ).toEqual({ ok: false, error: 'encode_failed' });
  });
});
