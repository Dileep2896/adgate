import { createHash } from 'node:crypto';

import { parsePolicy } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { canonicalize } from '../canonical/canonicalize.js';
import { policyHash } from './hash.js';

const policy = parsePolicy({ app_id: 'my-chat-app' });

/** Canonical JSON of the docs/policy.md default policy. A cross-language vector; change on purpose only. */
const DEFAULT_POLICY_CANONICAL =
  '{"allow_paid_tiers":false,"app_id":"my-chat-app","blocked_categories":["health","finance","politics","legal","adult","gambling","weapons","religion","self_harm"],"competitor_exclusions":[],"demand":[{"enabled":true,"source":"direct"},{"enabled":true,"network":"partnerstack","source":"affiliate"},{"enabled":false,"source":"koah"},{"enabled":false,"source":"gravity"}],"disclosure":{"label":"Sponsored","position":"after_answer","style":"separate_block"},"frequency_caps":{"min_turns_between":4,"per_session":1,"per_user_per_day":3},"min_commercial_intent":0.6,"min_confidence":0.7,"privacy":{"retain_days":90,"store_raw_text":false},"regions":{"allow":["US","CA","GB","EU"]},"sensitive_detection":"strict","serve_to_tiers":["free"],"version":1}';

describe('policyHash', () => {
  it('is sha256: plus the hex SHA-256 of the canonical JSON of the policy', () => {
    const digest = createHash('sha256').update(canonicalize(policy), 'utf8').digest('hex');
    expect(policyHash(policy)).toBe(`sha256:${digest}`);
    expect(policyHash(policy)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('canonicalizes the docs/policy.md default policy to the pinned vector', () => {
    expect(canonicalize(policy)).toBe(DEFAULT_POLICY_CANONICAL);
  });

  it('pins the hash of the docs/policy.md default policy', () => {
    expect(policyHash(policy)).toBe(
      'sha256:f7443a7f6a44e611bf4deb2d6517341e680f3bae153e7bb3f805ac1d6c0603ae',
    );
  });

  it('ignores key order and changes with any value', () => {
    const reordered = parsePolicy({
      regions: { allow: ['US', 'CA', 'GB', 'EU'] },
      version: 1,
      app_id: 'my-chat-app',
    });
    expect(policyHash(reordered)).toBe(policyHash(policy));
    expect(policyHash(parsePolicy({ app_id: 'my-chat-app', min_confidence: 0.71 }))).not.toBe(
      policyHash(policy),
    );
    expect(policyHash(parsePolicy({ app_id: 'other-app' }))).not.toBe(policyHash(policy));
  });
});
