import type { CreativeFieldIssue, CreativeFormValues } from './creative-issue';
import type { PolicyIssueView } from './policy-issue';

/**
 * The shapes the admin server actions hand back to their forms. They live here and not next
 * to the actions because a `'use server'` module may only export async functions.
 *
 * `errors` are form problems (a blank name, a missing id); `issues` are policy schema problems
 * with the path the operator has to fix. A form shows both, never a stack trace.
 */

export interface CreatedApp {
  appId: string;
  name: string;
  keyId: string;
  policyHash: string;
  policyVersion: number;
  /**
   * The full API key, ONCE. adgate stores only an argon2id hash, so this string exists in the
   * action's return value and in the browser's React state and nowhere else: never in the
   * session, a cookie, a query string, the URL, or a log line. Reloading the page loses it.
   */
  apiKey: string;
}

export type CreateAppState =
  | { status: 'idle' }
  | { status: 'invalid'; errors: string[]; issues: PolicyIssueView[] }
  | { status: 'created'; app: CreatedApp };

export const INITIAL_CREATE_APP_STATE: CreateAppState = { status: 'idle' };

export type PolicySaveState =
  | { status: 'idle' }
  | { status: 'invalid'; errors: string[]; issues: PolicyIssueView[] }
  | { status: 'saved'; policyVersion: number; policyHash: string };

export const INITIAL_POLICY_SAVE_STATE: PolicySaveState = { status: 'idle' };

/**
 * The creative editor. There is no 'saved' state: a successful save REDIRECTS to the creative's
 * own page, which reads the stored row back and shows its new content_hash, so what the operator
 * sees afterwards is the database and not the form's memory of it.
 *
 * A refusal carries the submitted `values` and an `attempt` counter, because React 19 resets an
 * uncontrolled form once its action has run: the editor re-mounts on each attempt with these
 * values as the new defaults, so nothing an operator typed is lost by a validation error.
 */
export type CreativeSaveState =
  | { status: 'idle' }
  | {
      status: 'invalid';
      attempt: number;
      values: CreativeFormValues;
      issues: CreativeFieldIssue[];
    };

export const INITIAL_CREATIVE_SAVE_STATE: CreativeSaveState = { status: 'idle' };

/** What a form says when the database, not the operator, is the problem. */
export const WRITE_FAILED_MESSAGE =
  'The gateway database rejected that write. Nothing was changed. Check the dashboard logs.';
