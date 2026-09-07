import type {
  DemandEntry,
  DemandEntryOverride,
  OverrideRejection,
  PolicyConfig,
  PolicyOverrides,
} from '@adgateio/schemas';

import { expandRegions } from './regions.js';

/**
 * docs/policy.md "Overrides": policy_overrides may only make the stored policy stricter. Every
 * value that would loosen it is ignored and reported in `rejected` (the audit record later notes
 * each as override_rejected). Values equal to the stored policy are silent no-ops.
 *
 * Tightening, per field family:
 * - serve_to_tiers: the override is intersected with the stored list; tiers it would add are
 *   rejected while its removals still apply.
 * - regions.allow: compared on expanded countries (EU is its 27 member states), so an entry is
 *   kept when the stored list already covers every country it names (DE on a stored EU) and
 *   rejected only when it would add a country. An override rejected in full is ignored like any
 *   other loosening value; an explicit empty list is a deliberate "serve nowhere" and applies.
 * - allow_paid_tiers: true -> false applies (and drops non-free tiers); false -> true is rejected.
 * - blocked_categories and competitor_exclusions: unioned, never rejected.
 * - sensitive_detection: balanced -> strict applies; strict -> balanced is rejected.
 * - min_commercial_intent, min_confidence, frequency_caps.min_turns_between: may only go up.
 * - frequency_caps.per_session, per_user_per_day: may only go down.
 * - demand: an entry with enabled: false disables the matching stored entries (affiliate without a
 *   network matches every affiliate entry); enabling, or naming a source the policy lacks, is
 *   rejected.
 * - privacy.store_raw_text: true -> false applies; false -> true is rejected.
 * - version, app_id, disclosure.* and privacy.retain_days are per-app settings: any change is
 *   rejected.
 */
export interface MergedPolicy {
  policy: PolicyConfig;
  rejected: OverrideRejection[];
}

type Reject = (path: string, reason: string) => void;

export const mergeOverrides = (policy: PolicyConfig, overrides: PolicyOverrides): MergedPolicy => {
  const merged = structuredClone(policy);
  const rejected: OverrideRejection[] = [];
  const reject: Reject = (path, reason) => {
    rejected.push({ path, reason });
  };

  mergeIdentity(merged, overrides, reject);
  mergeTiers(merged, overrides, reject);
  mergeAdditiveLists(merged, overrides);
  mergeSensitiveDetection(merged, overrides, reject);
  mergeThresholds(merged, overrides, reject);
  mergeFrequencyCaps(merged, overrides, reject);
  mergeDisclosure(merged, overrides, reject);
  mergeDemand(merged, overrides, reject);
  mergePrivacy(merged, overrides, reject);
  mergeRegions(merged, overrides, reject);

  return { policy: merged, rejected };
};

/** Items of `base` also present in `allowed` (base order) and the items `allowed` would add. */
const intersect = <T>(base: readonly T[], allowed: readonly T[]) => ({
  kept: base.filter((item) => allowed.includes(item)),
  added: [...new Set(allowed.filter((item) => !base.includes(item)))],
});

/** `base` unchanged, followed by the items of `extra` it lacks. */
const union = <T>(base: readonly T[], extra: readonly T[]): T[] => [
  ...base,
  ...new Set(extra.filter((item) => !base.includes(item))),
];

/** Applies a numeric override only in the stricter direction; returns the value to keep. */
const tighten = (
  path: string,
  current: number,
  value: number | undefined,
  stricter: 'lower' | 'higher',
  reject: Reject,
): number => {
  if (value === undefined || value === current) {
    return current;
  }
  if (stricter === 'lower' ? value < current : value > current) {
    return value;
  }
  reject(
    path,
    `cannot ${stricter === 'lower' ? 'raise' : 'lower'} ${path} from ${current} to ${value}`,
  );
  return current;
};

const mergeIdentity = (merged: PolicyConfig, overrides: PolicyOverrides, reject: Reject) => {
  for (const key of ['version', 'app_id'] as const) {
    const value = overrides[key];
    if (value !== undefined && value !== merged[key]) {
      reject(key, `${key} cannot be overridden`);
    }
  }
};

const mergeTiers = (merged: PolicyConfig, overrides: PolicyOverrides, reject: Reject) => {
  if (overrides.serve_to_tiers !== undefined) {
    const { kept, added } = intersect(merged.serve_to_tiers, overrides.serve_to_tiers);
    merged.serve_to_tiers = kept;
    if (added.length > 0) {
      reject('serve_to_tiers', `cannot add tiers: ${added.join(', ')}`);
    }
  }
  if (overrides.allow_paid_tiers === true && !merged.allow_paid_tiers) {
    reject('allow_paid_tiers', 'cannot enable paid tiers');
  }
  if (overrides.allow_paid_tiers === false && merged.allow_paid_tiers) {
    merged.allow_paid_tiers = false;
    merged.serve_to_tiers = merged.serve_to_tiers.filter((tier) => tier === 'free');
  }
};

const mergeAdditiveLists = (merged: PolicyConfig, overrides: PolicyOverrides) => {
  if (overrides.blocked_categories !== undefined) {
    merged.blocked_categories = union(merged.blocked_categories, overrides.blocked_categories);
  }
  if (overrides.competitor_exclusions !== undefined) {
    merged.competitor_exclusions = union(
      merged.competitor_exclusions,
      overrides.competitor_exclusions,
    );
  }
};

const mergeSensitiveDetection = (
  merged: PolicyConfig,
  overrides: PolicyOverrides,
  reject: Reject,
) => {
  if (overrides.sensitive_detection === 'strict') {
    merged.sensitive_detection = 'strict';
  } else if (
    overrides.sensitive_detection === 'balanced' &&
    merged.sensitive_detection === 'strict'
  ) {
    reject('sensitive_detection', 'cannot relax sensitive_detection from strict to balanced');
  }
};

const mergeThresholds = (merged: PolicyConfig, overrides: PolicyOverrides, reject: Reject) => {
  for (const key of ['min_commercial_intent', 'min_confidence'] as const) {
    merged[key] = tighten(key, merged[key], overrides[key], 'higher', reject);
  }
};

const mergeFrequencyCaps = (merged: PolicyConfig, overrides: PolicyOverrides, reject: Reject) => {
  const caps = overrides.frequency_caps;
  if (caps === undefined) {
    return;
  }
  const current = merged.frequency_caps;
  for (const key of ['per_session', 'per_user_per_day'] as const) {
    current[key] = tighten(`frequency_caps.${key}`, current[key], caps[key], 'lower', reject);
  }
  // More turns between ads is the stricter direction.
  current.min_turns_between = tighten(
    'frequency_caps.min_turns_between',
    current.min_turns_between,
    caps.min_turns_between,
    'higher',
    reject,
  );
};

const mergeDisclosure = (merged: PolicyConfig, overrides: PolicyOverrides, reject: Reject) => {
  const disclosure = overrides.disclosure;
  if (disclosure === undefined) {
    return;
  }
  for (const key of ['label', 'position', 'style'] as const) {
    const value = disclosure[key];
    if (value !== undefined && value !== merged.disclosure[key]) {
      reject(`disclosure.${key}`, 'disclosure cannot be overridden per request');
    }
  }
};

const demandLabel = (entry: DemandEntryOverride): string =>
  entry.source === 'affiliate' && entry.network !== undefined
    ? `affiliate/${entry.network}`
    : entry.source;

const matchesDemand = (entry: DemandEntry, override: DemandEntryOverride): boolean => {
  if (entry.source !== override.source) {
    return false;
  }
  if (entry.source === 'affiliate' && override.source === 'affiliate' && override.network) {
    return entry.network === override.network;
  }
  return true;
};

const mergeDemand = (merged: PolicyConfig, overrides: PolicyOverrides, reject: Reject) => {
  overrides.demand?.forEach((override, index) => {
    const path = `demand[${index}]`;
    const targets = merged.demand.filter((entry) => matchesDemand(entry, override));
    if (targets.length === 0) {
      reject(path, `cannot add demand source ${demandLabel(override)}`);
      return;
    }
    if (override.enabled === false) {
      for (const target of targets) {
        target.enabled = false;
      }
      return;
    }
    if (override.enabled === true && targets.some((target) => !target.enabled)) {
      reject(path, `cannot enable demand source ${demandLabel(override)}`);
    }
  });
};

const mergePrivacy = (merged: PolicyConfig, overrides: PolicyOverrides, reject: Reject) => {
  const privacy = overrides.privacy;
  if (privacy === undefined) {
    return;
  }
  if (privacy.store_raw_text === false) {
    merged.privacy.store_raw_text = false;
  } else if (privacy.store_raw_text === true && !merged.privacy.store_raw_text) {
    reject('privacy.store_raw_text', 'cannot enable raw text storage');
  }
  if (privacy.retain_days !== undefined && privacy.retain_days !== merged.privacy.retain_days) {
    reject('privacy.retain_days', 'retain_days cannot be overridden per request');
  }
};

const mergeRegions = (merged: PolicyConfig, overrides: PolicyOverrides, reject: Reject) => {
  const allow = overrides.regions?.allow;
  if (allow === undefined) {
    return;
  }
  const stored = expandRegions(merged.regions.allow);
  const kept: string[] = [];
  const added: string[] = [];
  for (const entry of new Set(allow)) {
    const covered = [...expandRegions([entry])].every((country) => stored.has(country));
    (covered ? kept : added).push(entry);
  }
  if (added.length > 0) {
    reject('regions.allow', `cannot add regions: ${added.join(', ')}`);
  }
  if (kept.length > 0 || added.length === 0) {
    merged.regions.allow = kept;
  }
};
