import type { AuditRecord } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { attest } from './attest.js';
import { nextPrevHash, signRecord, unsignedOf } from './chain.js';
import { sha256Prefixed } from './crypto.js';
import { flipLastHexDigit } from './crypto.fixture.js';
import { verify } from './verify.js';
import { VERIFY_DETAIL, type VerifyContext } from './verify-checks.js';
import { ATTESTATION_FIELDS } from './verify-supersedes.js';
import {
  ATTESTED_AT,
  attestedPair,
  checkOf,
  failedNames,
  MODEL_OUTPUT_HASH,
  RING,
  serveRecord,
  SIGNING,
  STORED_CREATIVE_HASH,
  suppressRecord,
} from './verify.fixture.js';

describe('supersedes check', () => {
  const { original, attested } = attestedPair();
  const originalCtx = { prevRecord: null, storedCreativeHash: STORED_CREATIVE_HASH };
  const base = { prevRecord: original, storedCreativeHash: STORED_CREATIVE_HASH };
  const supersedesOf = (ctx: VerifyContext) =>
    checkOf(verify(attested, RING, { ...base, ...ctx }), 'supersedes');
  /** A re-hashed, re-signed copy of the attestation with some body field changed. */
  const forge = (patch: Partial<AuditRecord>): AuditRecord =>
    signRecord({ ...unsignedOf(attested), ...patch }, SIGNING);

  it('not applicable when supersedes_hash is null', () => {
    expect(checkOf(verify(original, RING, originalCtx), 'supersedes')).toEqual({
      name: 'supersedes',
      ok: true,
      detail: 'not applicable',
    });
  });

  it('requires the superseded record, matching hash, id and app', () => {
    expect(supersedesOf({}).detail).toBe(VERIFY_DETAIL.superseded_missing);
    expect(supersedesOf({ supersededRecord: null }).detail).toBe(VERIFY_DETAIL.superseded_missing);
    const otherHash = { ...original, record_hash: flipLastHexDigit(original.record_hash) };
    expect(supersedesOf({ supersededRecord: otherHash }).detail).toBe(
      VERIFY_DETAIL.superseded_mismatch,
    );
    const otherId = { ...original, id: 'aud_01JOTHERID' };
    expect(supersedesOf({ supersededRecord: otherId }).detail).toBe(
      VERIFY_DETAIL.superseded_other_id,
    );
    const otherApp = { ...original, app_id: 'app_01JOTHERAPP' };
    expect(supersedesOf({ supersededRecord: otherApp }).detail).toBe(
      VERIFY_DETAIL.superseded_other_app,
    );
  });

  it('verifies the superseded record recursively under ctx.superseded', () => {
    expect(supersedesOf({ supersededRecord: original, superseded: originalCtx })).toEqual({
      name: 'supersedes',
      ok: true,
      detail: VERIFY_DETAIL.superseded_verified,
    });
    const wrongCreative = supersedesOf({
      supersededRecord: original,
      superseded: { prevRecord: null, storedCreativeHash: flipLastHexDigit(STORED_CREATIVE_HASH) },
    });
    expect(wrongCreative.ok).toBe(false);
    expect(wrongCreative.detail).toBe(`${VERIFY_DETAIL.superseded_invalid}: creative_hash`);
  });

  it('needs the superseded record’s own positional predecessor unless it is genesis', () => {
    const first = suppressRecord({ id: 'aud_01JFIRST' });
    const pair = attestedPair(serveRecord({ id: 'aud_01JSECOND', prev_hash: nextPrevHash(first) }));
    const ctx = {
      prevRecord: pair.original,
      storedCreativeHash: STORED_CREATIVE_HASH,
      supersededRecord: pair.original,
    };
    expect(
      checkOf(verify(pair.attested, RING, { ...ctx, superseded: {} }), 'supersedes').detail,
    ).toBe(`${VERIFY_DETAIL.superseded_invalid}: chain`);
    expect(verify(pair.attested, RING, { ...ctx, superseded: { prevRecord: first } }).valid).toBe(
      true,
    );
  });

  it('inherits storedCreativeHash into the nested context when absent there', () => {
    const exact = verify(attested, RING, {
      prevRecord: original,
      storedCreativeHash: STORED_CREATIVE_HASH,
      supersededRecord: original,
      superseded: { prevRecord: null },
    });
    expect(exact.valid).toBe(true);
    expect(checkOf(exact, 'supersedes').detail).toBe(VERIFY_DETAIL.superseded_verified);
    // An explicit nested value wins, null included (the gateway looked and found no row).
    expect(
      supersedesOf({
        supersededRecord: original,
        superseded: { prevRecord: null, storedCreativeHash: null },
      }).detail,
    ).toBe(`${VERIFY_DETAIL.superseded_invalid}: creative_hash`);
    // With no hash at either level both records fail on creative_hash.
    const none = verify(attested, RING, {
      prevRecord: original,
      supersededRecord: original,
      superseded: { prevRecord: null },
    });
    expect(failedNames(none)).toEqual(['creative_hash', 'supersedes']);
  });

  it('proves the separation of the unattested original through the attestation', () => {
    const nested = supersedesOf({ supersededRecord: original, superseded: originalCtx });
    expect(nested.ok).toBe(true);
    // On its own the original is still 'not attested'; the nested check passes supersededBy.
    expect(checkOf(verify(original, RING, originalCtx), 'separation_attested').detail).toBe(
      VERIFY_DETAIL.not_attested,
    );
  });

  it('rejects an attestation whose body differs from the superseded record (body_mismatch)', () => {
    const creativeSwap = forge({
      creative: {
        id: 'cr_01JEXAMPLEDB',
        advertiser: 'Someone Else',
        advertiser_domain: 'else.example',
        content_hash: STORED_CREATIVE_HASH,
      },
    });
    // Its own hash and signature are fine: only the supersedes check can catch the swap.
    const result = verify(creativeSwap, RING, {
      ...base,
      supersededRecord: original,
      superseded: originalCtx,
    });
    expect(checkOf(result, 'record_hash').ok).toBe(true);
    expect(checkOf(result, 'signature').ok).toBe(true);
    expect(checkOf(result, 'supersedes')).toEqual({
      name: 'supersedes',
      ok: false,
      detail: VERIFY_DETAIL.body_mismatch,
    });
    expect(failedNames(result)).toEqual(['supersedes']);
    const patches: Partial<AuditRecord>[] = [
      { classification: { ...attested.classification, confidence: 0.5 } },
      { disclosure: { ...attested.disclosure, label: 'Ad' } },
      { turn_id: 'turn_8' },
      { ts: '2026-09-02T18:04:12Z' },
      { override_rejected: [{ path: 'frequency_caps.per_session', reason: 'cannot raise' }] },
      { demand: { ...attested.demand, selected: 'affiliate' } },
      { policy_hash: sha256Prefixed('another policy') },
    ];
    for (const patch of patches) {
      const check = checkOf(
        verify(forge(patch), RING, {
          ...base,
          supersededRecord: original,
          superseded: originalCtx,
        }),
        'supersedes',
      );
      expect(check.detail, JSON.stringify(patch)).toBe(VERIFY_DETAIL.body_mismatch);
    }
    // Identity includes the body even when the recursive verification is skipped.
    expect(
      checkOf(
        verify(creativeSwap, RING, {
          ...base,
          supersededRecord: original,
          verifySuperseded: false,
        }),
        'supersedes',
      ).detail,
    ).toBe(VERIFY_DETAIL.body_mismatch);
    // A superseded record tampered after the fact (stale hash) fails the same way.
    const tampered = {
      ...original,
      classification: { ...original.classification, confidence: 0.5 },
    };
    expect(supersedesOf({ supersededRecord: tampered, superseded: originalCtx }).detail).toBe(
      VERIFY_DETAIL.body_mismatch,
    );
    expect([...ATTESTATION_FIELDS].sort()).toEqual([
      'attested_at',
      'key_id',
      'model_output_hash',
      'prev_hash',
      'record_hash',
      'separation_attestation',
      'signature',
      'supersedes_hash',
    ]);
  });

  it('reports a superseded record that does not parse without recursing', () => {
    const check = supersedesOf({
      supersededRecord: { ...original, ts: 'yesterday' } as unknown as AuditRecord,
      superseded: originalCtx,
    });
    expect(check).toEqual({
      name: 'supersedes',
      ok: false,
      detail: `${VERIFY_DETAIL.superseded_invalid}: schema`,
    });
  });

  it('verifySuperseded false only checks presence, identity and body', () => {
    const check = supersedesOf({ supersededRecord: original, verifySuperseded: false });
    expect(check).toEqual({
      name: 'supersedes',
      ok: true,
      detail: VERIFY_DETAIL.superseded_not_verified,
    });
    const wrongId = { ...original, id: 'aud_01JOTHERID' };
    expect(supersedesOf({ supersededRecord: wrongId, verifySuperseded: false }).ok).toBe(false);
  });

  it('rejects a superseded record that is itself an attestation (no chains of attestations)', () => {
    // attest() refuses to re-attest, so a second attestation is forged by hand: strip the
    // attestation fields of the attested record but keep its record_hash and signature.
    const stripped = {
      ...attested,
      model_output_hash: null,
      separation_attestation: false,
      attested_at: null,
      supersedes_hash: null,
    };
    const second = attest(stripped, MODEL_OUTPUT_HASH, ATTESTED_AT, {
      prev_hash: nextPrevHash(attested),
      signing: SIGNING,
    });
    expect(second.supersedes_hash).toBe(attested.record_hash);
    const result = verify(second, RING, {
      prevRecord: attested,
      storedCreativeHash: STORED_CREATIVE_HASH,
      supersededRecord: attested,
      superseded: { ...base, supersededRecord: original, superseded: originalCtx },
    });
    expect(checkOf(result, 'supersedes')).toEqual({
      name: 'supersedes',
      ok: false,
      detail: VERIFY_DETAIL.superseded_is_attestation,
    });
    expect(failedNames(result)).toEqual(['supersedes']);
    // A cyclic context cannot recurse forever: the nested record is never an attestation.
    const cyclic: VerifyContext = { ...base, supersededRecord: original };
    cyclic.superseded = cyclic;
    expect(verify(attested, RING, cyclic).checks).toHaveLength(8);
  });
});
