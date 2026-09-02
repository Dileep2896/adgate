import { z } from 'zod';

/**
 * The policy engine's outputs and inputs that also appear in the audit record (docs/audit.md
 * policy_decisions) or are supplied by the gateway from the cap_state table. Defined here so
 * @adgate/core (the engine) and the AuditRecord schema share one definition.
 */

/** The docs/policy.md rules in the exact order they run. */
export const POLICY_RULES = [
  'serve_to_tiers',
  'regions',
  'blocked_categories',
  'min_confidence',
  'min_commercial_intent',
  'frequency_caps',
  'competitor_exclusions',
] as const;

export const PolicyRule = z.enum(POLICY_RULES).meta({
  title: 'PolicyRule',
  description: 'A docs/policy.md rule name, listed in the order the rules run.',
});
export type PolicyRule = z.infer<typeof PolicyRule>;

export const PolicyDecisionResult = z.enum(['pass', 'fail', 'pending']).meta({
  title: 'PolicyDecisionResult',
  description:
    'pass or fail for rules resolved by the policy engine; pending for competitor_exclusions, which is resolved during creative selection.',
});
export type PolicyDecisionResult = z.infer<typeof PolicyDecisionResult>;

export const PolicyDecision = z
  .object({
    rule: PolicyRule,
    result: PolicyDecisionResult,
    detail: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Human-readable context, e.g. session=0/1 day=1/3 turns_since=9. Never contains message text.',
      ),
  })
  .meta({
    title: 'PolicyDecision',
    description:
      'One entry of an audit record policy_decisions list: the outcome of one rule. Every rule records an entry, pass or fail.',
  });
export type PolicyDecision = z.infer<typeof PolicyDecision>;

const Count = z.number().int().min(0);

export const CapState = z
  .object({
    session_count: Count.describe('Ads already served in this conversation.'),
    day_count: Count.describe(
      'Ads already served to this user today. Only meaningful when user.user_hash is present.',
    ),
    turns_since_last: Count.nullable().describe(
      'Turns since the last ad in this conversation, or null when no ad has been served yet.',
    ),
  })
  .meta({
    title: 'CapState',
    description:
      'Frequency-cap counters the gateway reads before evaluating policy. The policy engine is pure and receives them as input.',
  });
export type CapState = z.infer<typeof CapState>;
