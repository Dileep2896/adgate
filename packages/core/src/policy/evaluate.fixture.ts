import {
  parsePolicy,
  type CapState,
  type Classification,
  type PolicyConfig,
  type PolicyConfigInput,
  type Surface,
  type User,
} from '@adgate/schemas';

import type { EvaluatePolicyInput } from './evaluate.js';

/**
 * Test fixture (not exported from the package): an input that passes every rule under the
 * docs/policy.md default policy. Tests patch one field at a time to make a single rule fail.
 */

/** The docs/api.md example classification. */
export const SERVE_CLASSIFICATION: Classification = {
  commercial_intent: 0.84,
  categories: ['software.devtools.database'],
  sensitive: [],
  confidence: 0.91,
  method: 'llm',
  prompt_version: 'sha256:test-prompt',
};

export const FREE_US_USER: User = {
  tier: 'free',
  region: 'US',
  locale: 'en-US',
  user_hash: 'sha256:test-user',
};

/** No ad served yet in this conversation or to this user today. */
export const FRESH_CAP_STATE: CapState = {
  session_count: 0,
  day_count: 0,
  turns_since_last: null,
};

export const CHAT_SURFACE: Surface = { type: 'chat', placement: 'after_answer', max_creatives: 1 };

/** The docs/policy.md default policy, optionally patched. */
export const defaultPolicy = (patch: Partial<PolicyConfigInput> = {}): PolicyConfig =>
  parsePolicy({ app_id: 'my-chat-app', ...patch });

export const serveInput = (patch: Partial<EvaluatePolicyInput> = {}): EvaluatePolicyInput => ({
  classification: SERVE_CLASSIFICATION,
  user: FREE_US_USER,
  policy: defaultPolicy(),
  capState: FRESH_CAP_STATE,
  surface: CHAT_SURFACE,
  ...patch,
});
