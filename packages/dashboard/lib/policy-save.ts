import type { PolicyIssueView } from './policy-issue';
import { validatePolicyYaml } from './policy-validation';

/**
 * Saving an edited policy: validate, then persist, in that order and never the other way
 * round. The persistence step is a port (PolicyWriter) so this function is unit tested with a
 * fake that records whether it was called at all - "invalid YAML writes nothing" is the whole
 * point and is worth proving without a database.
 *
 * The Postgres implementation of the port is lib/admin-store.ts.
 */

export interface PolicyUpdate {
  appId: string;
  /** Stored verbatim, exactly as the operator typed it. */
  policyYaml: string;
  /** policyHash() of the fully defaulted policy the YAML parses to. */
  policyHash: string;
}

/** What the UPDATE returns: the row after the version bump. */
export interface SavedPolicy {
  policyVersion: number;
  policyHash: string;
}

export interface PolicyWriter {
  /** Bumps policy_version by one and stores the document and its hash. Null: no such app. */
  update(update: PolicyUpdate): Promise<SavedPolicy | null>;
}

export type SavePolicyResult =
  | { ok: true; policyVersion: number; policyHash: string }
  | { ok: false; issues: PolicyIssueView[] };

export const APP_NOT_FOUND_ISSUE: PolicyIssueView = {
  path: '',
  message: 'That app no longer exists.',
};

export interface SavePolicyInput {
  appId: string;
  policyYaml: string;
}

/**
 * Validates `policyYaml` against the PolicyConfig schema (including that its app_id is this
 * app) and, only if it is valid, writes it. On failure the writer is never touched, so the
 * stored document, its hash and its version are exactly what they were.
 */
export const savePolicy = async (
  writer: PolicyWriter,
  input: SavePolicyInput,
): Promise<SavePolicyResult> => {
  const validation = validatePolicyYaml(input.policyYaml, input.appId);
  if (!validation.ok) {
    return validation;
  }
  const saved = await writer.update({
    appId: input.appId,
    policyYaml: input.policyYaml,
    policyHash: validation.policyHash,
  });
  if (saved === null) {
    return { ok: false, issues: [APP_NOT_FOUND_ISSUE] };
  }
  return { ok: true, policyVersion: saved.policyVersion, policyHash: saved.policyHash };
};
