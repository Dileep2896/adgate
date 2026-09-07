import { readFileSync } from 'node:fs';

import {
  parsePolicyYaml,
  PolicyConfig,
  PolicyValidationError as SchemasPolicyValidationError,
} from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { PolicyValidationError } from '../index.js';
import { policyHash } from './hash.js';
import { loadPolicyFromYaml } from './load.js';

const exampleYaml = readFileSync(
  new URL('../../../../examples/policy.example.yaml', import.meta.url),
  'utf8',
);

/** examples/policy.example.yaml with keys reordered, different indentation, quoting and comments. */
const REORDERED_YAML = `# Same policy as examples/policy.example.yaml, written differently.
regions:
    allow:
        - "US"
        - CA
        - GB
        - EU
privacy: { retain_days: 90, store_raw_text: false }
demand:
    - enabled: true
      source: direct
    - { enabled: true, network: partnerstack, source: affiliate }
    - { source: koah, enabled: false }
    - enabled: false
      source: gravity
disclosure:
    style: separate_block
    position: after_answer
    label: Sponsored          # unquoted
frequency_caps: { min_turns_between: 4, per_user_per_day: 3, per_session: 1 }
competitor_exclusions: [ ]
min_confidence: 0.70
min_commercial_intent: 0.6
sensitive_detection: "strict"
blocked_categories:
    - health
    - finance
    - politics
    - legal
    - adult
    - gambling
    - weapons
    - religion
    - self_harm
serve_to_tiers:
    - free
app_id: "example-chat"
version: 1.0
`;

/** The same policy again, relying on the defaults for everything the example spells out. */
const MINIMAL_YAML = `app_id: example-chat
`;

describe('loadPolicyFromYaml', () => {
  it('returns the validated policy and its hash for examples/policy.example.yaml', () => {
    const { policy, policy_hash } = loadPolicyFromYaml(exampleYaml);
    expect(policy).toEqual(parsePolicyYaml(exampleYaml));
    // The example spells out every documented default, so it equals a defaulted parse.
    expect(policy).toEqual(PolicyConfig.parse({ app_id: 'example-chat' }));
    expect(policy.app_id).toBe('example-chat');
    expect(policy_hash).toBe(policyHash(policy));
    expect(policy_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('hashes identically across key order, whitespace, quoting, comments and omitted defaults', () => {
    const fromExample = loadPolicyFromYaml(exampleYaml);
    const fromReordered = loadPolicyFromYaml(REORDERED_YAML);
    const fromMinimal = loadPolicyFromYaml(MINIMAL_YAML);
    expect(fromReordered.policy).toEqual(fromExample.policy);
    expect(fromMinimal.policy).toEqual(fromExample.policy);
    expect(fromReordered.policy_hash).toBe(fromExample.policy_hash);
    expect(fromMinimal.policy_hash).toBe(fromExample.policy_hash);
  });

  it('changes the hash when any value changes', () => {
    const changed = loadPolicyFromYaml(
      exampleYaml.replace('min_confidence: 0.7', 'min_confidence: 0.8'),
    );
    expect(changed.policy_hash).not.toBe(loadPolicyFromYaml(exampleYaml).policy_hash);
  });

  it('throws the PolicyValidationError class from @adgateio/schemas', () => {
    expect(PolicyValidationError).toBe(SchemasPolicyValidationError);
    expect(() => loadPolicyFromYaml('app_id: [')).toThrow(PolicyValidationError);
    expect(() => loadPolicyFromYaml('app_id: x\nunknown: 1')).toThrow(PolicyValidationError);
    expect(() => loadPolicyFromYaml('app_id: x\nblocked_categories: [health]')).toThrow(
      /self_harm cannot be removed/,
    );
  });
});
