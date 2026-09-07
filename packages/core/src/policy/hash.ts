import type { PolicyConfig, Sha256Hash } from '@adgateio/schemas';

import { sha256Prefixed } from '../audit/crypto.js';
import { canonicalize } from '../canonical/canonicalize.js';

/**
 * docs/policy.md: policy_hash is sha256 over the canonical JSON of the fully defaulted policy, so
 * equivalent YAML files hash the same. Pass a PolicyConfig produced by parsePolicy,
 * parsePolicyYaml or mergeOverrides; those are always fully defaulted.
 */
export const policyHash = (policy: PolicyConfig): Sha256Hash =>
  sha256Prefixed(canonicalize(policy));
