import * as schemas from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('@adgate/core', () => {
  it('exports the canonical JSON and policy helpers', () => {
    expect(typeof core.canonicalize).toBe('function');
    expect(typeof core.sha256Hex).toBe('function');
    expect(typeof core.sha256Prefixed).toBe('function');
    expect(typeof core.policyHash).toBe('function');
    expect(typeof core.loadPolicyFromYaml).toBe('function');
    expect(typeof core.mergeOverrides).toBe('function');
  });

  it('re-exports PolicyValidationError from @adgate/schemas', () => {
    expect(core.PolicyValidationError).toBe(schemas.PolicyValidationError);
  });
});
