import { canonicalize } from '../../canonical/canonicalize.js';
import { sha256Prefixed } from '../../canonical/sha256.js';
import { RULES_DATA } from './data/index.js';
import type { RulesData } from './types.js';

/**
 * The rule set version reported as Classification.prompt_version for method 'rules':
 * `sha256:<hex>` over the canonical JSON (docs/audit.md rules) of the whole keyword registry,
 * including patterns, aliases, intent phrases and scoring constants. Any edit to a data file
 * changes it, so an audit record pins exactly which rules produced a decision.
 */
export const computeRulesVersion = (data: RulesData): string => sha256Prefixed(canonicalize(data));

export const RULES_VERSION: string = computeRulesVersion(RULES_DATA);
