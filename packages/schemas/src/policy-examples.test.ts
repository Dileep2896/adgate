import { describe, expect, it } from 'vitest';

import { PolicyConfig } from './policy.js';
import { POLICY_DOC_EXAMPLE, POLICY_DOC_YAML } from './policy.fixture.js';
import { parsePolicyYaml } from './policy-loader.js';

describe('docs/policy.md full example', () => {
  it('parses, with comments, to exactly the documented object', () => {
    expect(parsePolicyYaml(POLICY_DOC_YAML)).toEqual(POLICY_DOC_EXAMPLE);
  });

  it('is what an app_id alone expands to (every default is the documented one)', () => {
    expect(PolicyConfig.parse({ app_id: 'my-chat-app' })).toEqual(POLICY_DOC_EXAMPLE);
  });

  it('round-trips through the schema unchanged', () => {
    expect(PolicyConfig.parse(POLICY_DOC_EXAMPLE)).toEqual(POLICY_DOC_EXAMPLE);
  });
});
