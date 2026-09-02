import {
  POLICY_RULES,
  sensitiveCategoryReason,
  type CapState,
  type Classification,
  type PolicyConfig,
  type PolicyDecision,
  type PolicyRule,
  type SensitiveCategory,
  type SuppressReason,
  type Surface,
  type User,
} from '@adgate/schemas';

import { isRegionAllowed } from './regions.js';

/**
 * The policy engine (docs/policy.md "Rule order"). The seven rules run in POLICY_RULES order;
 * the first failure sets the suppress reason and every rule still records a decision, so the
 * audit record shows the full picture. Pure: no I/O, clock or env. The gateway reads capState
 * from the cap_state table and passes it in. competitor_exclusions is applied during creative
 * selection and is only recorded here as pending.
 */
export interface EvaluatePolicyInput {
  classification: Classification;
  user: User;
  policy: PolicyConfig;
  capState: CapState;
  /** Accepted for completeness; placement after_answer is already enforced by the schema. */
  surface: Surface;
}

export interface PolicyEvaluation {
  allowed: boolean;
  /** The first failing rule's reason, or null when no rule failed. */
  reason: SuppressReason | null;
  /** One entry per rule, in POLICY_RULES order. */
  decisions: PolicyDecision[];
}

type RuleOutcome =
  | { result: 'pass'; detail?: string }
  | { result: 'pending' }
  | { result: 'fail'; reason: SuppressReason; detail: string };

type RuleCheck = (input: EvaluatePolicyInput) => RuleOutcome;

const pass = (detail?: string): RuleOutcome =>
  detail === undefined ? { result: 'pass' } : { result: 'pass', detail };

const fail = (reason: SuppressReason, detail: string): RuleOutcome => ({
  result: 'fail',
  reason,
  detail,
});

/** Rule 1: the user's tier must be listed. Any other tier, paid or not, is `paid_user`. */
const checkServeToTiers: RuleCheck = ({ user, policy }) => {
  const { tier } = user;
  if (!policy.serve_to_tiers.includes(tier)) {
    return fail('paid_user', `tier=${tier} not in serve_to_tiers`);
  }
  // CLAUDE.md: paid tiers never get ads unless allow_paid_tiers is true. The schema already
  // enforces this on serve_to_tiers; checking again keeps a hand-built policy from bypassing it.
  if (tier !== 'free' && !policy.allow_paid_tiers) {
    return fail('paid_user', `tier=${tier} requires allow_paid_tiers`);
  }
  return pass();
};

/** Rule 2: the user's country must be admitted by regions.allow. No region fails closed. */
const checkRegions: RuleCheck = ({ user, policy }) => {
  if (user.region === undefined) {
    return fail('region_blocked', 'region missing');
  }
  return isRegionAllowed(user.region, policy.regions.allow)
    ? pass()
    : fail('region_blocked', `region=${user.region} not in regions.allow`);
};

/**
 * Rule 3: no blocked category may appear in classification.sensitive or .categories. The first
 * match in policy order names the reason. self_harm is blocked even if a hand-built policy
 * dropped it (the schema forbids that).
 */
const checkBlockedCategories: RuleCheck = ({ classification, policy }) => {
  const blocked: readonly SensitiveCategory[] = policy.blocked_categories.includes('self_harm')
    ? policy.blocked_categories
    : [...policy.blocked_categories, 'self_harm'];
  const sensitive: readonly string[] = classification.sensitive;
  const categories: readonly string[] = classification.categories;
  for (const name of blocked) {
    if (sensitive.includes(name)) {
      return fail(sensitiveCategoryReason(name), `${name} in sensitive`);
    }
    if (categories.includes(name)) {
      return fail(sensitiveCategoryReason(name), `${name} in categories`);
    }
  }
  return pass();
};

/** Written so that a NaN score never passes: `NaN >= min` is false. */
const meetsThreshold = (score: number, min: number): boolean => score >= min;

/** Rule 4. */
const checkMinConfidence: RuleCheck = ({ classification, policy }) =>
  meetsThreshold(classification.confidence, policy.min_confidence)
    ? pass()
    : fail(
        'low_confidence',
        `confidence=${classification.confidence} min=${policy.min_confidence}`,
      );

/** Rule 5. */
const checkMinCommercialIntent: RuleCheck = ({ classification, policy }) =>
  meetsThreshold(classification.commercial_intent, policy.min_commercial_intent)
    ? pass()
    : fail(
        'low_commercial_intent',
        `commercial_intent=${classification.commercial_intent} min=${policy.min_commercial_intent}`,
      );

const hasUserHash = (user: User): boolean =>
  typeof user.user_hash === 'string' && user.user_hash.length > 0;

/**
 * Rule 6: every cap must have room. A count equal to its cap is exhausted; per_user_per_day only
 * applies when the user has a user_hash; min_turns_between is satisfied when no ad has been
 * served yet (turns_since_last null) or the gap is at least the minimum. The detail follows the
 * docs/audit.md example: `session=0/1 day=1/3 turns_since=9`, with `day=n/a` when there is no
 * user_hash and `turns_since=none` when null. Comparisons are written so that NaN fails.
 */
const checkFrequencyCaps: RuleCheck = ({ user, policy, capState }) => {
  const caps = policy.frequency_caps;
  const dayApplies = hasUserHash(user);
  const detail = [
    `session=${capState.session_count}/${caps.per_session}`,
    `day=${dayApplies ? `${capState.day_count}/${caps.per_user_per_day}` : 'n/a'}`,
    `turns_since=${capState.turns_since_last ?? 'none'}`,
  ].join(' ');
  const sessionOk = capState.session_count < caps.per_session;
  const dayOk = !dayApplies || capState.day_count < caps.per_user_per_day;
  const turnsOk =
    capState.turns_since_last === null || capState.turns_since_last >= caps.min_turns_between;
  return sessionOk && dayOk && turnsOk ? pass(detail) : fail('frequency_cap', detail);
};

/** Rule 7: resolved during mediation against each candidate's advertiser domain. */
const checkCompetitorExclusions: RuleCheck = () => ({ result: 'pending' });

const RULES: Record<PolicyRule, RuleCheck> = {
  serve_to_tiers: checkServeToTiers,
  regions: checkRegions,
  blocked_categories: checkBlockedCategories,
  min_confidence: checkMinConfidence,
  min_commercial_intent: checkMinCommercialIntent,
  frequency_caps: checkFrequencyCaps,
  competitor_exclusions: checkCompetitorExclusions,
};

const toDecision = (rule: PolicyRule, outcome: RuleOutcome): PolicyDecision =>
  outcome.result === 'pending' || outcome.detail === undefined
    ? { rule, result: outcome.result }
    : { rule, result: outcome.result, detail: outcome.detail };

export const evaluatePolicy = (input: EvaluatePolicyInput): PolicyEvaluation => {
  const decisions: PolicyDecision[] = [];
  let reason: SuppressReason | null = null;
  for (const rule of POLICY_RULES) {
    const outcome = RULES[rule](input);
    decisions.push(toDecision(rule, outcome));
    if (outcome.result === 'fail' && reason === null) {
      reason = outcome.reason;
    }
  }
  return { allowed: reason === null, reason, decisions };
};
