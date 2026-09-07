import { loadPolicyFromYaml } from '@adgateio/core';
import { describe, expect, it } from 'vitest';

import {
  APP_NOT_FOUND_ISSUE,
  type PolicyUpdate,
  type PolicyWriter,
  savePolicy,
  type SavedPolicy,
} from './policy-save';

/**
 * The validate-then-persist rule, with the database faked. The point of every test here is
 * what the writer DID NOT see: an invalid document must never reach it.
 */

const APP_ID = 'app_01J0000000000000000000TEST';
const VALID = `version: 1\napp_id: ${APP_ID}\n`;

interface FakeWriter extends PolicyWriter {
  readonly calls: PolicyUpdate[];
}

const fakeWriter = (row: SavedPolicy | null = { policyVersion: 2, policyHash: 'unused' }) => {
  const calls: PolicyUpdate[] = [];
  const writer: FakeWriter = {
    calls,
    update: (update) => {
      calls.push(update);
      // The real UPDATE returns the row it just wrote, hash included.
      return Promise.resolve(
        row === null ? null : { policyVersion: row.policyVersion, policyHash: update.policyHash },
      );
    },
  };
  return writer;
};

describe('savePolicy', () => {
  it('stores the document verbatim with the hash loadPolicyFromYaml computes', async () => {
    const writer = fakeWriter();
    const result = await savePolicy(writer, { appId: APP_ID, policyYaml: VALID });

    expect(result).toEqual({
      ok: true,
      policyVersion: 2,
      policyHash: loadPolicyFromYaml(VALID).policy_hash,
    });
    expect(writer.calls).toEqual([
      { appId: APP_ID, policyYaml: VALID, policyHash: loadPolicyFromYaml(VALID).policy_hash },
    ]);
  });

  it('writes nothing when the policy drops self_harm', async () => {
    const writer = fakeWriter();
    const result = await savePolicy(writer, {
      appId: APP_ID,
      policyYaml: `${VALID}blocked_categories: [health]\n`,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('blocked_categories');
      expect(result.issues[0]?.message).toBe('self_harm cannot be removed from blocked_categories');
    }
    expect(writer.calls).toHaveLength(0);
  });

  it('writes nothing when the YAML does not parse', async () => {
    const writer = fakeWriter();
    const result = await savePolicy(writer, {
      appId: APP_ID,
      policyYaml: 'version: 1\n  app_id: [unclosed\n',
    });

    expect(result.ok).toBe(false);
    expect(writer.calls).toHaveLength(0);
  });

  it('writes nothing when the document names a different app', async () => {
    const writer = fakeWriter();
    const result = await savePolicy(writer, {
      appId: 'app_another',
      policyYaml: VALID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('app_id');
    }
    expect(writer.calls).toHaveLength(0);
  });

  it('reports a vanished app instead of pretending the save worked', async () => {
    const writer = fakeWriter(null);
    const result = await savePolicy(writer, { appId: APP_ID, policyYaml: VALID });

    expect(result).toEqual({ ok: false, issues: [APP_NOT_FOUND_ISSUE] });
    expect(writer.calls).toHaveLength(1);
  });

  it('changes the hash when the policy is tightened', async () => {
    const writer = fakeWriter({ policyVersion: 3, policyHash: 'unused' });
    const before = await savePolicy(writer, { appId: APP_ID, policyYaml: VALID });
    const after = await savePolicy(writer, {
      appId: APP_ID,
      policyYaml: `${VALID}min_commercial_intent: 0.9\nfrequency_caps:\n  per_session: 1\n`,
    });

    expect(before.ok && after.ok && before.policyHash !== after.policyHash).toBe(true);
    expect(writer.calls).toHaveLength(2);
  });
});
