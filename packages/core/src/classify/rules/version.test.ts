import { describe, expect, it } from 'vitest';

import { classifyByRules } from './classify.js';
import { RULES_DATA } from './data/index.js';
import type { RulesData } from './types.js';
import { RULES_VERSION, computeRulesVersion } from './version.js';

const clone = (): RulesData => structuredClone(RULES_DATA);

describe('RULES_VERSION', () => {
  it('is a sha256: prefixed lowercase hex digest', () => {
    expect(RULES_VERSION).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is a pure function of the registry data', () => {
    expect(computeRulesVersion(clone())).toBe(RULES_VERSION);
    expect(computeRulesVersion(clone())).toBe(computeRulesVersion(clone()));
  });

  it('changes when a sensitive keyword list changes', () => {
    const data = clone();
    data.sensitive.health.strong = [...data.sensitive.health.strong, 'zzz'];
    expect(computeRulesVersion(data)).not.toBe(RULES_VERSION);
  });

  it('changes when a commercial keyword list changes', () => {
    const data = clone();
    const rules = data.commercial['software.devtools.database'];
    rules.products = rules.products.slice(1);
    expect(computeRulesVersion(data)).not.toBe(RULES_VERSION);
  });

  it('changes when a pattern, an alias, an intent phrase or a scoring constant changes', () => {
    const patterns = clone();
    patterns.sensitive.self_harm.patterns = [...patterns.sensitive.self_harm.patterns, 'x'];
    expect(computeRulesVersion(patterns)).not.toBe(RULES_VERSION);

    const aliases = clone();
    aliases.aliases = { ...aliases.aliases, teh: 'the' };
    expect(computeRulesVersion(aliases)).not.toBe(RULES_VERSION);

    const intent = clone();
    intent.intent = {
      ...intent.intent,
      phrases: [...intent.intent.phrases, { phrase: 'zzz', weight: 'weak' }],
    };
    expect(computeRulesVersion(intent)).not.toBe(RULES_VERSION);

    const scoring = clone();
    scoring.scoring.intent.product_hit += 0.01;
    expect(computeRulesVersion(scoring)).not.toBe(RULES_VERSION);
  });

  it('does not depend on object key order', () => {
    const data = clone();
    const { health, ...rest } = data.sensitive;
    data.sensitive = { ...rest, health } as RulesData['sensitive'];
    expect(computeRulesVersion(data)).toBe(RULES_VERSION);
  });

  it('is what classifyByRules reports as prompt_version', () => {
    expect(classifyByRules('best vpn for public wifi').prompt_version).toBe(RULES_VERSION);
    expect(classifyByRules('').prompt_version).toBe(RULES_VERSION);
  });
});
