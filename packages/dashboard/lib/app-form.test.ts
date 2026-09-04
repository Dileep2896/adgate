import { describe, expect, it } from 'vitest';

import {
  MAX_APP_NAME_LENGTH,
  MAX_POLICY_YAML_LENGTH,
  parseNewAppForm,
  parsePolicySaveForm,
  parseRevokeKeyForm,
  readText,
} from './app-form';

const form = (fields: Record<string, unknown>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, String(value));
  }
  return data;
};

describe('readText', () => {
  it('returns the value for a string field and "" for anything else', () => {
    expect(readText(form({ name: 'Acme' }), 'name')).toBe('Acme');
    expect(readText(form({}), 'name')).toBe('');
    expect(readText({ get: () => new Blob(['x']) }, 'name')).toBe('');
  });
});

describe('parseNewAppForm', () => {
  it('trims the name and treats a blank policy as "use the defaults"', () => {
    const result = parseNewAppForm(form({ name: '  Acme chat  ', policy_yaml: '   \n  ' }));
    expect(result).toEqual({ ok: true, value: { name: 'Acme chat', policyYaml: undefined } });
  });

  it('keeps a supplied policy document byte for byte', () => {
    const yaml = 'version: 1\napp_id: app_X\n\n# trailing comment\n';
    const result = parseNewAppForm(form({ name: 'Acme', policy_yaml: yaml }));
    expect(result).toEqual({ ok: true, value: { name: 'Acme', policyYaml: yaml } });
  });

  it('rejects a blank or missing name', () => {
    expect(parseNewAppForm(form({ name: '   ' }))).toEqual({
      ok: false,
      errors: ['Enter a name for the app.'],
    });
    expect(parseNewAppForm(form({}))).toEqual({
      ok: false,
      errors: ['Enter a name for the app.'],
    });
  });

  it('rejects an over-long name and an over-long policy', () => {
    const long = parseNewAppForm(form({ name: 'a'.repeat(MAX_APP_NAME_LENGTH + 1) }));
    expect(long.ok).toBe(false);
    const huge = parseNewAppForm(
      form({ name: 'Acme', policy_yaml: 'x'.repeat(MAX_POLICY_YAML_LENGTH + 1) }),
    );
    expect(huge.ok).toBe(false);
  });

  it('accepts a name exactly at the limit', () => {
    expect(parseNewAppForm(form({ name: 'a'.repeat(MAX_APP_NAME_LENGTH) })).ok).toBe(true);
  });
});

describe('parsePolicySaveForm', () => {
  it('reads the app id and the document', () => {
    const result = parsePolicySaveForm(form({ app_id: ' app_1 ', policy_yaml: 'version: 1\n' }));
    expect(result).toEqual({ ok: true, value: { appId: 'app_1', policyYaml: 'version: 1\n' } });
  });

  it('rejects an empty document rather than handing it to the YAML parser', () => {
    expect(parsePolicySaveForm(form({ app_id: 'app_1', policy_yaml: '  \n\t ' }))).toEqual({
      ok: false,
      errors: ['The policy document is empty.'],
    });
  });

  it('reports every problem at once', () => {
    const result = parsePolicySaveForm(form({}));
    expect(result).toEqual({
      ok: false,
      errors: ['Missing app id.', 'The policy document is empty.'],
    });
  });
});

describe('parseRevokeKeyForm', () => {
  it('needs both ids', () => {
    expect(parseRevokeKeyForm(form({ app_id: 'app_1', key_id: 'key_1' }))).toEqual({
      ok: true,
      value: { appId: 'app_1', keyId: 'key_1' },
    });
    expect(parseRevokeKeyForm(form({ app_id: 'app_1' }))).toEqual({
      ok: false,
      errors: ['Missing key id.'],
    });
  });
});
