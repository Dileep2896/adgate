import type { AuditRecord } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { attest } from './attest.js';
import { nextPrevHash } from './chain.js';
import { sha256Prefixed } from './crypto.js';
import { flipLastHexDigit } from './crypto.fixture.js';
import { verify } from './verify.js';
import { VERIFY_DETAIL } from './verify-checks.js';
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

const chainOf = (record: AuditRecord, prevRecord: unknown) =>
  checkOf(verify(record, RING, { prevRecord: prevRecord as AuditRecord }), 'chain');

describe('chain check', () => {
  const first = suppressRecord({ id: 'aud_01JFIRST' });
  const second = suppressRecord({ id: 'aud_01JSECOND', prev_hash: nextPrevHash(first) });

  it('genesis: ok only without a previous record', () => {
    expect(chainOf(first, null)).toEqual({ name: 'chain', ok: true, detail: 'genesis' });
    expect(chainOf(first, undefined).ok).toBe(true);
    expect(chainOf(first, second)).toEqual({
      name: 'chain',
      ok: false,
      detail: VERIFY_DETAIL.genesis_with_previous,
    });
    expect(chainOf(first, 'pruned').ok).toBe(false);
  });

  it('links: ok when the previous record carries prev_hash for the same app', () => {
    expect(chainOf(second, first)).toEqual({ name: 'chain', ok: true });
  });

  it('pruned: retention removed the predecessor (S37), reported as ok with detail pruned', () => {
    expect(chainOf(second, 'pruned')).toEqual({ name: 'chain', ok: true, detail: 'pruned' });
  });

  it('missing, mismatching or foreign previous records fail with a named detail', () => {
    expect(chainOf(second, null).detail).toBe(VERIFY_DETAIL.previous_missing);
    expect(chainOf(second, undefined).detail).toBe(VERIFY_DETAIL.previous_missing);
    expect(chainOf(second, 'something else').detail).toBe(VERIFY_DETAIL.previous_missing);
    expect(chainOf(second, 42).detail).toBe(VERIFY_DETAIL.previous_missing);
    const other = suppressRecord({ id: 'aud_01JOTHER', turn_id: 'turn_9' });
    expect(chainOf(second, other).detail).toBe(VERIFY_DETAIL.previous_mismatch);
    const foreign = { ...first, app_id: 'app_01JOTHERAPP' };
    expect(chainOf(second, foreign).detail).toBe(VERIFY_DETAIL.previous_other_app);
    expect(chainOf(second, {}).detail).toBe(VERIFY_DETAIL.previous_mismatch);
  });
});

describe('creative_hash check', () => {
  const record = serveRecord();
  const creativeOf = (storedCreativeHash: unknown) =>
    checkOf(
      verify(record, RING, { storedCreativeHash: storedCreativeHash as string }),
      'creative_hash',
    );

  it('not applicable for a suppress record, whatever the context says', () => {
    const suppressed = suppressRecord();
    expect(checkOf(verify(suppressed, RING, {}), 'creative_hash')).toEqual({
      name: 'creative_hash',
      ok: true,
      detail: 'not applicable',
    });
    expect(
      checkOf(verify(suppressed, RING, { storedCreativeHash: 'sha256:x' }), 'creative_hash').ok,
    ).toBe(true);
  });

  it('requires the stored creative hash and compares it exactly', () => {
    expect(creativeOf(STORED_CREATIVE_HASH)).toEqual({ name: 'creative_hash', ok: true });
    expect(creativeOf(undefined).detail).toBe(VERIFY_DETAIL.stored_creative_missing);
    expect(creativeOf(null).detail).toBe(VERIFY_DETAIL.stored_creative_missing);
    expect(creativeOf('').detail).toBe(VERIFY_DETAIL.stored_creative_missing);
    expect(creativeOf(flipLastHexDigit(STORED_CREATIVE_HASH)).detail).toBe(
      VERIFY_DETAIL.creative_mismatch,
    );
    expect(creativeOf(STORED_CREATIVE_HASH.toUpperCase()).ok).toBe(false);
    expect(creativeOf(42).ok).toBe(false);
  });
});

describe('disclosure_present check', () => {
  it('fails on a blank label (schema accepts it, the check does not)', () => {
    const blank = {
      ...suppressRecord(),
      disclosure: { label: '\t ', position: 'after_answer', style: 'separate_block' },
    };
    const result = verify(blank, RING, {});
    expect(checkOf(result, 'schema').ok).toBe(true);
    expect(checkOf(result, 'disclosure_present')).toEqual({
      name: 'disclosure_present',
      ok: false,
      detail: VERIFY_DETAIL.label_empty,
    });
  });

  it('an empty label or another position never reaches the check: schema rejects them', () => {
    const empty = {
      ...suppressRecord(),
      disclosure: { label: '', position: 'after_answer', style: 'separate_block' },
    };
    expect(checkOf(verify(empty, RING, {}), 'schema').ok).toBe(false);
    const inline = {
      ...suppressRecord(),
      disclosure: { label: 'Sponsored', position: 'inline', style: 'separate_block' },
    };
    expect(checkOf(verify(inline, RING, {}), 'schema').ok).toBe(false);
  });
});

describe('separation_attested check', () => {
  it('not applicable for an unattested suppress record, not attested for an unattested serve', () => {
    expect(checkOf(verify(suppressRecord(), RING, {}), 'separation_attested')).toEqual({
      name: 'separation_attested',
      ok: true,
      detail: 'not applicable',
    });
    expect(checkOf(verify(serveRecord(), RING, {}), 'separation_attested')).toEqual({
      name: 'separation_attested',
      ok: false,
      detail: 'not attested',
    });
  });

  it('fails a partial attestation on either decision', () => {
    for (const base of [serveRecord(), suppressRecord()]) {
      const partials = [
        { separation_attestation: true },
        { model_output_hash: MODEL_OUTPUT_HASH },
        { attested_at: ATTESTED_AT },
        { separation_attestation: true, model_output_hash: MODEL_OUTPUT_HASH },
      ];
      for (const patch of partials) {
        const check = checkOf(verify({ ...base, ...patch }, RING, {}), 'separation_attested');
        expect(check.ok, JSON.stringify(patch)).toBe(false);
        expect(check.detail).toBe(VERIFY_DETAIL.attestation_incomplete);
      }
    }
  });
});

describe('supersedes check', () => {
  const { original, attested } = attestedPair();
  const originalCtx = { prevRecord: null, storedCreativeHash: STORED_CREATIVE_HASH };
  const base = { prevRecord: original, storedCreativeHash: STORED_CREATIVE_HASH };
  const supersedesOf = (ctx: Parameters<typeof verify>[2]) =>
    checkOf(verify(attested, RING, { ...base, ...ctx }), 'supersedes');

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

  it('verifies the superseded record recursively with ctx.superseded', () => {
    expect(supersedesOf({ supersededRecord: original, superseded: originalCtx })).toEqual({
      name: 'supersedes',
      ok: true,
      detail: VERIFY_DETAIL.superseded_verified,
    });
    // Without its own context the original cannot prove its creative: the failure is named.
    const missing = supersedesOf({ supersededRecord: original, superseded: { prevRecord: null } });
    expect(missing.ok).toBe(false);
    expect(missing.detail).toBe(`${VERIFY_DETAIL.superseded_invalid}: creative_hash`);
    const tampered = {
      ...original,
      classification: { ...original.classification, confidence: 0.5 },
    };
    const forged = { ...attested, supersedes_hash: tampered.record_hash };
    const result = verify(forged, RING, {
      ...base,
      supersededRecord: tampered,
      superseded: originalCtx,
    });
    expect(checkOf(result, 'supersedes').ok).toBe(false);
  });

  it('the superseded record is not required to be attested itself', () => {
    const nested = supersedesOf({ supersededRecord: original, superseded: originalCtx });
    expect(nested.ok).toBe(true);
    expect(checkOf(verify(original, RING, originalCtx), 'separation_attested').ok).toBe(false);
  });

  it('verifySuperseded false only checks presence and identity', () => {
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
    const cyclic: Parameters<typeof verify>[2] = { ...base, supersededRecord: original };
    cyclic.superseded = cyclic;
    expect(verify(attested, RING, cyclic).checks).toHaveLength(8);
    expect(sha256Prefixed('no depth guard needed')).toMatch(/^sha256:/);
  });
});
