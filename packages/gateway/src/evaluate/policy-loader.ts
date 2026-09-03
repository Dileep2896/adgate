import { loadPolicyFromYaml } from '@adgate/core';
import type { PolicyConfig } from '@adgate/schemas';
import type { Logger } from 'pino';

import type { AppRow } from '../db/tables/apps.js';

/**
 * Parses an app's stored policy YAML once per (app, policy_hash) and hands the same fully
 * defaulted PolicyConfig to every request after that. registerApp writes policy_yaml and
 * policy_hash together, so a policy edit always changes the key. Callers must not mutate the
 * returned object (mergeOverrides clones it before applying request overrides). A YAML that no
 * longer parses throws PolicyValidationError, which the evaluate wrapper turns into decision
 * suppress, reason error: fail closed, never a half-applied policy. docs/policy.md requires a
 * warning when allow_paid_tiers is true: it is logged the first time such a policy is parsed
 * (once per cache entry, so once per (app, policy_hash) until eviction), with the app id and
 * the policy hash, never the document.
 */
export type PolicySource = Pick<AppRow, 'id' | 'policyYaml' | 'policyHash'>;

export interface PolicyLoader {
  /** `log` receives the allow_paid_tiers warning when this call parses the document. */
  load(app: PolicySource, log?: Logger): PolicyConfig;
  readonly size: number;
  clear(): void;
}

/** Enough for every tenant of one gateway; older entries are evicted first. */
export const POLICY_CACHE_MAX_ENTRIES = 1_000;

export const PAID_TIERS_WARNING = 'policy allows paid tiers';

export const createPolicyLoader = (maxEntries = POLICY_CACHE_MAX_ENTRIES): PolicyLoader => {
  const entries = new Map<string, PolicyConfig>();
  return {
    get size() {
      return entries.size;
    },
    load(app, log) {
      const key = `${app.id}\n${app.policyHash}`;
      const hit = entries.get(key);
      if (hit !== undefined) {
        return hit;
      }
      const { policy } = loadPolicyFromYaml(app.policyYaml);
      if (policy.allow_paid_tiers) {
        log?.warn({ app_id: app.id, policy_hash: app.policyHash }, PAID_TIERS_WARNING);
      }
      entries.set(key, policy);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) {
          break;
        }
        entries.delete(oldest.value);
      }
      return policy;
    },
    clear() {
      entries.clear();
    },
  };
};
