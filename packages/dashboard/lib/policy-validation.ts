import { loadPolicyFromYaml, PolicyValidationError } from '@adgateio/core';

import type { PolicyIssueView } from './policy-issue';

/**
 * The dashboard's view of policy validation. It does not re-implement any of it: the document
 * goes through loadPolicyFromYaml (@adgateio/core), the same function the gateway and
 * `create-app` use, so what the editor accepts is exactly what the gateway will parse and
 * exactly what policy_hash is computed from.
 *
 * Pure: no database, no React, no environment. The page renders the issues; this decides them.
 *
 * SERVER ONLY in practice: it pulls in @adgateio/core (zod, the YAML parser, the policy schema).
 * A client component that only needs to PRINT an issue imports lib/policy-issue.ts instead, so
 * none of that reaches the browser bundle.
 */

export type PolicyValidation =
  { ok: true; policyHash: string } | { ok: false; issues: PolicyIssueView[] };

/**
 * Whether a thrown error is a policy validation failure. The `name` and duck-type check is the
 * backstop for the case where a bundler hands the thrower and the catcher two copies of the
 * class, which would make `instanceof` silently false and turn a fixable typo in the YAML into
 * an opaque "something went wrong".
 */
export const isPolicyValidationError = (
  error: unknown,
): error is { issues: readonly PolicyIssueView[] } => {
  if (error instanceof PolicyValidationError) {
    return true;
  }
  const candidate = error as { name?: unknown; issues?: unknown };
  return candidate?.name === 'PolicyValidationError' && Array.isArray(candidate.issues);
};

/**
 * The issues inside a thrown error. Anything that is not a PolicyValidationError degrades to
 * one root issue with the error's own message, so the editor always has something exact to
 * show and never a blank box.
 */
export const issuesFromError = (error: unknown): PolicyIssueView[] => {
  if (isPolicyValidationError(error)) {
    return error.issues.map((issue) => ({
      path: String(issue.path ?? ''),
      message: String(issue.message),
    }));
  }
  return [{ path: '', message: error instanceof Error ? error.message : String(error) }];
};

/**
 * Validates one YAML document and returns the policy_hash it would be stored with. When
 * `expectedAppId` is given the document's own `app_id` must match it: an app whose stored
 * policy names a different app is a silent misconfiguration, and the editor knows the id.
 * The app registration form has no id yet, so it calls this without one.
 */
export const validatePolicyYaml = (
  policyYaml: string,
  expectedAppId?: string | undefined,
): PolicyValidation => {
  let loaded;
  try {
    loaded = loadPolicyFromYaml(policyYaml);
  } catch (error) {
    return { ok: false, issues: issuesFromError(error) };
  }
  if (expectedAppId !== undefined && loaded.policy.app_id !== expectedAppId) {
    return {
      ok: false,
      issues: [
        {
          path: 'app_id',
          message: `must be ${expectedAppId} (this app), not ${loaded.policy.app_id}`,
        },
      ],
    };
  }
  return { ok: true, policyHash: loaded.policy_hash };
};
