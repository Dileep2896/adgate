import * as schemas from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('@adgateio/core', () => {
  it('exports the canonical JSON and policy helpers', () => {
    expect(typeof core.canonicalize).toBe('function');
    expect(typeof core.sha256Hex).toBe('function');
    expect(typeof core.sha256Prefixed).toBe('function');
    expect(typeof core.policyHash).toBe('function');
    expect(typeof core.loadPolicyFromYaml).toBe('function');
    expect(typeof core.mergeOverrides).toBe('function');
  });

  it('exports the audit hashing, signing and key helpers', () => {
    expect(typeof core.sign).toBe('function');
    expect(typeof core.verifySignature).toBe('function');
    expect(typeof core.verifyWithPublicKey).toBe('function');
    expect(typeof core.decodeSignature).toBe('function');
    expect(typeof core.loadPrivateKey).toBe('function');
    expect(typeof core.loadPublicKey).toBe('function');
    expect(typeof core.generateKeypair).toBe('function');
    expect(typeof core.defaultKeyId).toBe('function');
    expect(typeof core.derivePublicPem).toBe('function');
    expect(typeof core.createKeyRing).toBe('function');
    expect(typeof core.parsePublicKeysJson).toBe('function');
    expect(typeof core.isKeyId).toBe('function');
    expect(typeof core.AuditKeyError).toBe('function');
    expect(core.SIGNATURE_PREFIX).toBe('ed25519:');
    expect(core.ED25519_SIGNATURE_BYTES).toBe(64);
    expect(core.KEY_ID_PREFIX).toBe('k_');
    const pair = core.generateKeypair({ now: () => Date.UTC(2026, 8, 2) });
    expect(pair.key_id).toBe('k_2026_09');
    const hash = core.sha256Prefixed('record');
    const signature = core.sign(hash, pair.private_pem);
    expect(core.verifySignature(hash, signature, pair.public_pem)).toBe(true);
    expect(
      core.createKeyRing({ [pair.key_id]: pair.public_pem }).verify(hash, signature, pair.key_id),
    ).toEqual({
      ok: true,
      detail: 'key_id=k_2026_09',
    });
  });

  it('exports the audit record builder and the hash chain', () => {
    expect(typeof core.buildAuditRecord).toBe('function');
    expect(typeof core.buildAuditBody).toBe('function');
    expect(typeof core.computeRecordHash).toBe('function');
    expect(typeof core.recordHashInput).toBe('function');
    expect(typeof core.signRecord).toBe('function');
    expect(typeof core.unsignedOf).toBe('function');
    expect(typeof core.nextPrevHash).toBe('function');
    expect(typeof core.emptyDemandTrace).toBe('function');
    expect(typeof core.creativeContentHash).toBe('function');
    expect(typeof core.creativeContent).toBe('function');
    expect(typeof core.conversationIdHash).toBe('function');
    expect(typeof core.userHash).toBe('function');
    expect(typeof core.normalizeSha256Hash).toBe('function');
    expect(core.GENESIS).toBe('genesis');
    expect(core.nextPrevHash(null)).toBe('genesis');
    expect(core.CREATIVE_CONTENT_FIELDS).toHaveLength(6);
  });

  it('exports attest and verify', () => {
    expect(typeof core.attest).toBe('function');
    expect(typeof core.verify).toBe('function');
    expect(typeof core.isAttested).toBe('function');
    expect(typeof core.isUnattested).toBe('function');
    expect(typeof core.AuditAttestError).toBe('function');
    expect(core.VERIFY_CHECK_ORDER).toEqual(schemas.VerifyCheckName.options);
    expect(core.VERIFY_DETAIL.pruned).toBe('pruned');
    expect(core.VERIFY_DETAIL.not_applicable).toBe('not applicable');
    const pair = core.generateKeypair({ keyId: 'k_index' });
    const ring = core.createKeyRing({ k_index: pair.public_pem });
    const result = core.verify(null, ring, {});
    expect(result.valid).toBe(false);
    expect(result.checks.map((check) => check.name)).toEqual(core.VERIFY_CHECK_ORDER);
  });

  it('exports the policy engine and the region helpers', () => {
    expect(typeof core.evaluatePolicy).toBe('function');
    expect(typeof core.isRegionAllowed).toBe('function');
    expect(typeof core.expandRegions).toBe('function');
    expect(core.EU_MEMBER_STATES).toHaveLength(27);
  });

  it('exports the rules classifier', () => {
    expect(typeof core.classifyByRules).toBe('function');
    expect(typeof core.normalizeText).toBe('function');
    expect(typeof core.computeRulesVersion).toBe('function');
    expect(core.RULES_VERSION).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(core.classifyByRules('best vpn for public wifi').method).toBe('rules');
  });

  it('exports the LLM classifier, its fake and the versioned prompt', () => {
    expect(typeof core.OpenAiCompatibleClassifier).toBe('function');
    expect(typeof core.FakeLlmClassifier).toBe('function');
    expect(typeof core.fakeLlmFromFixtures).toBe('function');
    expect(typeof core.fakeLlmSuccess).toBe('function');
    expect(typeof core.parseLlmContent).toBe('function');
    expect(typeof core.computePromptVersion).toBe('function');
    expect(core.CLASSIFIER_PROMPT.length).toBeGreaterThan(200);
    expect(core.PROMPT_VERSION).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(core.PROMPT_VERSION).not.toBe(core.RULES_VERSION);
    expect(core.DEFAULT_LLM_TIMEOUT_MS).toBe(400);
    expect(core.LLM_FAILURE_REASONS).toEqual([
      'timeout',
      'parse',
      'invalid',
      'http',
      'network',
      'aborted',
    ]);
  });

  it('exports the classify orchestrator, its cache and text preparation', () => {
    expect(typeof core.classify).toBe('function');
    expect(typeof core.prepareText).toBe('function');
    expect(typeof core.createLruCache).toBe('function');
    expect(typeof core.classifyCacheKey).toBe('function');
    expect(typeof core.mergeClassifications).toBe('function');
    expect(typeof core.failClosedClassification).toBe('function');
    expect(core.DEFAULT_PREPARE_OPTIONS).toEqual({ maxMessages: 4, maxChars: 4000 });
    expect(core.DEFAULT_CACHE_MAX_ENTRIES).toBe(50_000);
    expect(core.DEFAULT_CACHE_TTL_MS).toBe(600_000);
  });

  it('exports the demand adapter surface and the ULID helpers', () => {
    expect(typeof core.createDirectAdapter).toBe('function');
    expect(typeof core.DirectAdapter).toBe('function');
    expect(typeof core.selectDirectCandidates).toBe('function');
    expect(typeof core.assignCreativeIds).toBe('function');
    expect(typeof core.keywordsFromRulesMatches).toBe('function');
    expect(typeof core.matchesTargetCategory).toBe('function');
    expect(typeof core.creativeServesRegion).toBe('function');
    expect(core.DEFAULT_DEMAND_TIMEOUT_MS).toBe(250);
    expect(core.DIRECT_MAX_CANDIDATES).toBe(3);
    expect(core.CREATIVE_ID_PREFIX).toBe('cr_');
    expect(typeof core.ulid).toBe('function');
    expect(typeof core.prefixedUlid).toBe('function');
    expect(core.ULID_PATTERN.test(core.ulid())).toBe(true);
  });

  it('exports mediation and the competitor exclusion helpers', () => {
    expect(typeof core.mediate).toBe('function');
    expect(typeof core.mediationScore).toBe('function');
    expect(typeof core.compareByRevenue).toBe('function');
    expect(typeof core.isExcludedDomain).toBe('function');
    expect(typeof core.domainMatches).toBe('function');
    expect(typeof core.normalizeDomain).toBe('function');
    expect(core.MEDIATION_TIMEOUT_ERROR).toBe('timeout');
    expect(core.MEDIATION_ABORTED_ERROR).toBe('aborted');
    expect(core.ADAPTER_ERROR_PREFIX).toBe('adapter_error:');
  });

  it('exports the Koah and Gravity stubs (docs/decisions.md item 10)', () => {
    expect(typeof core.createKoahAdapter).toBe('function');
    expect(typeof core.KoahAdapter).toBe('function');
    expect(typeof core.createGravityAdapter).toBe('function');
    expect(typeof core.GravityAdapter).toBe('function');
    expect(typeof core.NetworkStubAdapter).toBe('function');
    expect(typeof core.isNetworkConfigured).toBe('function');
    expect(core.NETWORK_NOT_CONFIGURED).toBe('not_configured');
    expect(core.NETWORK_NOT_IMPLEMENTED).toBe('not_implemented');
    expect(core.createKoahAdapter({ enabled: false }).source).toBe('koah');
    expect(core.createGravityAdapter({ enabled: false }).source).toBe('gravity');
  });

  it('re-exports PolicyValidationError from @adgateio/schemas', () => {
    expect(core.PolicyValidationError).toBe(schemas.PolicyValidationError);
  });
});
