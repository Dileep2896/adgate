import { PolicyValidationError } from '@adgateio/core';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import { createPolicyLoader, PAID_TIERS_WARNING } from './policy-loader.js';

const source = (id: string, policyHash: string, yaml = `app_id: ${id}\n`) => ({
  id,
  policyHash,
  policyYaml: yaml,
});

describe('createPolicyLoader', () => {
  it('parses once per (app, policy_hash) and returns the same object afterwards', () => {
    const loader = createPolicyLoader();
    const first = loader.load(source('app_1', 'sha256:a'));
    const second = loader.load(source('app_1', 'sha256:a', 'app_id: other\n'));
    expect(second).toBe(first);
    expect(first.app_id).toBe('app_1');
    expect(first.frequency_caps.per_session).toBe(1);
    expect(loader.size).toBe(1);
  });

  it('re-parses when the policy hash changes and keeps apps apart', () => {
    const loader = createPolicyLoader();
    const before = loader.load(source('app_1', 'sha256:a'));
    const after = loader.load(source('app_1', 'sha256:b', 'app_id: app_1\nmin_confidence: 0.9\n'));
    expect(after).not.toBe(before);
    expect(after.min_confidence).toBe(0.9);
    expect(loader.load(source('app_2', 'sha256:a')).app_id).toBe('app_2');
    expect(loader.size).toBe(3);
  });

  it('evicts the oldest entry past the limit and clears on demand', () => {
    const loader = createPolicyLoader(2);
    const first = loader.load(source('app_1', 'sha256:a'));
    loader.load(source('app_2', 'sha256:a'));
    loader.load(source('app_3', 'sha256:a'));
    expect(loader.size).toBe(2);
    expect(loader.load(source('app_1', 'sha256:a'))).not.toBe(first);
    loader.clear();
    expect(loader.size).toBe(0);
  });

  it('warns once per (app, policy_hash) when a policy allows paid tiers, with ids only', () => {
    const { lines, stream } = collectLogs();
    const log = createLogger({ level: 'warn' }, stream);
    const loader = createPolicyLoader();
    const yaml = 'app_id: app_1\nallow_paid_tiers: true\n';
    expect(loader.load(source('app_1', 'sha256:paid', yaml), log).allow_paid_tiers).toBe(true);
    loader.load(source('app_1', 'sha256:paid', yaml), log);
    loader.load(source('app_2', 'sha256:free'), log);
    const warnings = lines.filter((line) => line.includes(PAID_TIERS_WARNING));
    expect(warnings).toHaveLength(1);
    expect(JSON.parse(warnings[0] ?? '{}')).toMatchObject({
      level: 40,
      app_id: 'app_1',
      policy_hash: 'sha256:paid',
    });
    expect(warnings[0]).not.toContain('allow_paid_tiers: true');
    expect(() => loader.load(source('app_3', 'sha256:paid', yaml))).not.toThrow();
  });

  it('throws PolicyValidationError for a stored document that no longer parses', () => {
    const loader = createPolicyLoader();
    expect(() =>
      loader.load(source('app_1', 'sha256:x', 'blocked_categories: [health]\n')),
    ).toThrow(PolicyValidationError);
    expect(loader.size).toBe(0);
  });
});
