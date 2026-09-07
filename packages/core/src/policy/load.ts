import { parsePolicyYaml, type PolicyConfig, type Sha256Hash } from '@adgateio/schemas';

import { policyHash } from './hash.js';

export interface LoadedPolicy {
  policy: PolicyConfig;
  policy_hash: Sha256Hash;
}

/**
 * Parses and validates one YAML policy document and computes its policy_hash. Throws
 * PolicyValidationError (re-exported from this package) on YAML or validation errors; it is meant
 * for config-time callers, never for the request path.
 */
export const loadPolicyFromYaml = (yamlText: string): LoadedPolicy => {
  const policy = parsePolicyYaml(yamlText);
  return { policy, policy_hash: policyHash(policy) };
};
