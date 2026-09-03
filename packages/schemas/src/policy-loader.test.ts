import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PolicyConfig } from './policy.js';
import { POLICY_DOC_EXAMPLE } from './policy.fixture.js';
import { parsePolicy, parsePolicyYaml, PolicyValidationError } from './policy-loader.js';

const exampleYaml = readFileSync(
  new URL('../../../examples/policy.example.yaml', import.meta.url),
  'utf8',
);

/** examples/policy.example.yaml spells out every documented default, so it equals a defaulted parse. */
const POLICY_EXAMPLE_FILE_EXPECTED = PolicyConfig.parse({ app_id: 'example-chat' });

const failure = (fn: () => unknown): PolicyValidationError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a PolicyValidationError');
};

describe('parsePolicyYaml', () => {
  it('loads examples/policy.example.yaml as the fully defaulted policy', () => {
    expect(parsePolicyYaml(exampleYaml)).toEqual(POLICY_EXAMPLE_FILE_EXPECTED);
  });

  it('reports YAML syntax errors as a root PolicyValidationError', () => {
    const error = failure(() => parsePolicyYaml('app_id: x\nregions:\n  allow: [US, CA'));
    expect(error.name).toBe('PolicyValidationError');
    expect(error).toBeInstanceOf(Error);
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.path).toBe('');
    expect(error.issues[0]?.message.startsWith('YAML syntax: ')).toBe(true);
    expect(error.message).toContain('(root): YAML syntax: ');
  });

  it('rejects duplicate keys and multiple documents', () => {
    expect(() => parsePolicyYaml('app_id: a\napp_id: b')).toThrow(PolicyValidationError);
    expect(() => parsePolicyYaml('app_id: a\n---\napp_id: b')).toThrow(PolicyValidationError);
  });

  it('rejects an empty document and a scalar document', () => {
    expect(() => parsePolicyYaml('')).toThrow(PolicyValidationError);
    expect(() => parsePolicyYaml('# only a comment\n')).toThrow(PolicyValidationError);
    expect(() => parsePolicyYaml('just a string')).toThrow(PolicyValidationError);
  });

  it('uses the YAML 1.2 core schema, so yes is a string and not a boolean', () => {
    const error = failure(() => parsePolicyYaml('app_id: x\nallow_paid_tiers: yes'));
    expect(error.issues.map((issue) => issue.path)).toEqual(['allow_paid_tiers']);
  });

  it('formats validation issues with dotted paths and array indexes', () => {
    const error = failure(() =>
      parsePolicyYaml(
        [
          'app_id: x',
          'frequency_caps: { per_session: -1 }',
          'demand:',
          '  - source: direct',
          '  - source: affiliate',
          'unknown_key: 1',
        ].join('\n'),
      ),
    );
    expect(error.issues.map((issue) => issue.path).sort()).toEqual([
      '',
      'demand[1].network',
      'frequency_caps.per_session',
    ]);
    expect(error.message.split('\n')[0]).toBe('Invalid policy:');
    expect(error.message).toContain('  - frequency_caps.per_session: ');
    expect(error.message).toContain('  - demand[1].network: ');
    expect(error.message).toContain('  - (root): Unrecognized key: "unknown_key"');
  });
});

describe('parsePolicy', () => {
  it('validates an already parsed JSON document and applies defaults', () => {
    const json = JSON.stringify({ app_id: 'my-chat-app' });
    expect(parsePolicy(JSON.parse(json))).toEqual(POLICY_DOC_EXAMPLE);
  });

  it('throws PolicyValidationError with the zod issues for invalid input', () => {
    const error = failure(() => parsePolicy({ app_id: 'x', serve_to_tiers: ['paid'] }));
    expect(error.issues).toEqual([
      {
        path: 'serve_to_tiers',
        message:
          'serve_to_tiers includes non-free tiers (paid); set allow_paid_tiers: true to allow this',
      },
    ]);
    expect(() => parsePolicy(null)).toThrow(PolicyValidationError);
    expect(() => parsePolicy(undefined)).toThrow(PolicyValidationError);
  });
});
