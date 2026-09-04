/**
 * One policy validation problem, and how a form prints it.
 *
 * This is deliberately its OWN module with no imports: the forms are client components, and
 * anything they reach ends up in the browser bundle. lib/policy-validation.ts imports
 * @adgate/core (zod, the YAML parser, the whole policy schema) to decide what is valid, which
 * is 200 kB the browser has no use for - validation happens in a server action. Keeping the
 * shape and the formatting here lets the forms render issues without dragging any of it in.
 */

/** `path` is dotted, with [n] for array indexes; '' is the document root. */
export interface PolicyIssueView {
  path: string;
  message: string;
}

/** `blocked_categories: self_harm cannot be removed`, or just the message at the root. */
export const formatPolicyIssue = (issue: PolicyIssueView): string =>
  issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`;
