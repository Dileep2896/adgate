import { loadPolicyFromYaml, PolicyValidationError } from '@adgateio/core';
import { describe, expect, it } from 'vitest';

import { issuesFromError, isPolicyValidationError, validatePolicyYaml } from './policy-validation';

const APP_ID = 'app_01J0000000000000000000TEST';
const MINIMAL = `version: 1\napp_id: ${APP_ID}\n`;

describe('validatePolicyYaml', () => {
  it('accepts a minimal document and returns the same hash loadPolicyFromYaml computes', () => {
    const result = validatePolicyYaml(MINIMAL, APP_ID);
    expect(result).toEqual({ ok: true, policyHash: loadPolicyFromYaml(MINIMAL).policy_hash });
    if (result.ok) {
      expect(result.policyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('gives a different hash for a tightened policy', () => {
    const tightened = `${MINIMAL}min_commercial_intent: 0.9\n`;
    const before = validatePolicyYaml(MINIMAL, APP_ID);
    const after = validatePolicyYaml(tightened, APP_ID);
    expect(before.ok && after.ok && before.policyHash !== after.policyHash).toBe(true);
  });

  it('reports the schema message when self_harm is dropped from blocked_categories', () => {
    const result = validatePolicyYaml(`${MINIMAL}blocked_categories: [health]\n`, APP_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        {
          path: 'blocked_categories',
          message: 'self_harm cannot be removed from blocked_categories',
        },
      ]);
    }
  });

  it('reports an unknown key', () => {
    const result = validatePolicyYaml(`${MINIMAL}not_a_policy_key: 3\n`, APP_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.message).toMatch(/not_a_policy_key/);
    }
  });

  it('reports every problem at once (the e2e "loosened policy" case)', () => {
    const result = validatePolicyYaml(
      `${MINIMAL}blocked_categories: [health]\nnot_a_policy_key: 3\n`,
      APP_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        { path: '', message: 'Unrecognized key: "not_a_policy_key"' },
        {
          path: 'blocked_categories',
          message: 'self_harm cannot be removed from blocked_categories',
        },
      ]);
    }
  });

  it('reports a YAML syntax error at the document root', () => {
    const result = validatePolicyYaml('version: 1\n  app_id: [unclosed\n', APP_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('');
      expect(result.issues[0]?.message).toMatch(/^YAML syntax:/);
    }
  });

  it('rejects an empty document', () => {
    expect(validatePolicyYaml('', APP_ID).ok).toBe(false);
  });

  it('rejects a document whose app_id is a different app', () => {
    const result = validatePolicyYaml(MINIMAL, 'app_someone_else');
    expect(result).toEqual({
      ok: false,
      issues: [{ path: 'app_id', message: `must be app_someone_else (this app), not ${APP_ID}` }],
    });
  });

  it('does not check app_id when none is expected (the registration form has no id yet)', () => {
    expect(validatePolicyYaml(MINIMAL).ok).toBe(true);
  });
});

describe('issuesFromError', () => {
  it('unwraps a PolicyValidationError', () => {
    const error = new PolicyValidationError([{ path: 'regions.allow', message: 'bad region' }]);
    expect(isPolicyValidationError(error)).toBe(true);
    expect(issuesFromError(error)).toEqual([{ path: 'regions.allow', message: 'bad region' }]);
  });

  it('recognises a structurally identical error from a second copy of the class', () => {
    const lookalike = { name: 'PolicyValidationError', issues: [{ path: 'x', message: 'nope' }] };
    expect(isPolicyValidationError(lookalike)).toBe(true);
    expect(issuesFromError(lookalike)).toEqual([{ path: 'x', message: 'nope' }]);
  });

  it('degrades any other error to a single root issue', () => {
    expect(isPolicyValidationError(new Error('connection refused'))).toBe(false);
    expect(issuesFromError(new Error('connection refused'))).toEqual([
      { path: '', message: 'connection refused' },
    ]);
    expect(issuesFromError('boom')).toEqual([{ path: '', message: 'boom' }]);
  });
});
