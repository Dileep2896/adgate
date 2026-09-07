import type { AuditRecord } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { nextPrevHash } from './chain.js';
import { flipLastHexDigit } from './crypto.fixture.js';
import { type PrunedPredecessor, verify } from './verify.js';
import { VERIFY_DETAIL } from './verify-checks.js';
import {
  ATTESTED_AT,
  attestedPair,
  checkOf,
  failedNames,
  MODEL_OUTPUT_HASH,
  RING,
  serveRecord,
  STORED_CREATIVE_HASH,
  suppressRecord,
} from './verify.fixture.js';

/** chain, creative_hash, disclosure_present and separation_attested; supersedes has its own file. */
const chainOf = (record: AuditRecord, prevRecord: unknown) =>
  checkOf(verify(record, RING, { prevRecord: prevRecord as AuditRecord }), 'chain');

describe('chain check (positional predecessor)', () => {
  const first = suppressRecord({ id: 'aud_01JFIRST' });
  const second = suppressRecord({ id: 'aud_01JSECOND', prev_hash: nextPrevHash(first) });
  const third = suppressRecord({ id: 'aud_01JTHIRD', prev_hash: nextPrevHash(second) });

  it('genesis: ok only without a previous record', () => {
    expect(chainOf(first, null)).toEqual({ name: 'chain', ok: true, detail: 'genesis' });
    expect(chainOf(first, undefined).ok).toBe(true);
    expect(chainOf(first, second)).toEqual({
      name: 'chain',
      ok: false,
      detail: VERIFY_DETAIL.genesis_with_previous,
    });
    expect(chainOf(first, { pruned: true, retain_cutoff: '2026-01-01T00:00:00Z' }).detail).toBe(
      VERIFY_DETAIL.genesis_with_previous,
    );
  });

  it('links: ok when the positional predecessor carries prev_hash for the same app', () => {
    expect(chainOf(second, first)).toEqual({ name: 'chain', ok: true });
    expect(chainOf(third, second)).toEqual({ name: 'chain', ok: true });
  });

  it('a fork fails: prev_hash pointing at an older record than the positional predecessor', () => {
    // The chain is first -> second -> third. A record signed after third but chained to first
    // has a valid hash and signature, yet it forks the chain: with third as its positional
    // predecessor the check fails. Loading "the record whose hash equals prev_hash" would have
    // handed it first and let the fork through, which is why the context is positional.
    const fork = suppressRecord({ id: 'aud_01JFORK', prev_hash: nextPrevHash(first) });
    expect(chainOf(fork, first).ok).toBe(true);
    expect(chainOf(fork, third)).toEqual({
      name: 'chain',
      ok: false,
      detail: VERIFY_DETAIL.previous_mismatch,
    });
    expect(failedNames(verify(fork, RING, { prevRecord: third }))).toEqual(['chain']);
  });

  it('a re-signed record claiming genesis in the middle of a chain fails', () => {
    const resigned = suppressRecord({ id: 'aud_01JSECOND', prev_hash: 'genesis' });
    expect(checkOf(verify(resigned, RING, { prevRecord: null }), 'record_hash').ok).toBe(true);
    expect(chainOf(resigned, first)).toEqual({
      name: 'chain',
      ok: false,
      detail: VERIFY_DETAIL.genesis_with_previous,
    });
    expect(failedNames(verify(resigned, RING, { prevRecord: first }))).toEqual(['chain']);
  });

  describe('pruned predecessor (S37 retention)', () => {
    // The fixture records carry ts 2026-09-02T18:04:11Z.
    const kept: PrunedPredecessor = { pruned: true, retain_cutoff: '2026-09-01T00:00:00Z' };

    it('is ok with detail pruned when the record post-dates the retention cutoff', () => {
      expect(chainOf(second, kept)).toEqual({ name: 'chain', ok: true, detail: 'pruned' });
      expect(chainOf(second, { pruned: true, retain_cutoff: second.ts })).toEqual({
        name: 'chain',
        ok: true,
        detail: VERIFY_DETAIL.pruned,
      });
      expect(verify(second, RING, { prevRecord: kept }).valid).toBe(true);
    });

    it('fails when the record itself predates the cutoff: retention cannot explain the gap', () => {
      expect(chainOf(second, { pruned: true, retain_cutoff: '2026-09-03T00:00:00Z' })).toEqual({
        name: 'chain',
        ok: false,
        detail: VERIFY_DETAIL.pruned_before_cutoff,
      });
      expect(chainOf(second, { pruned: true, retain_cutoff: '2026-09-02T18:04:12Z' }).ok).toBe(
        false,
      );
    });

    it('fails on a malformed marker and no longer accepts the bare pruned sentinel', () => {
      expect(chainOf(second, { pruned: true }).detail).toBe(VERIFY_DETAIL.pruned_before_cutoff);
      expect(chainOf(second, { pruned: true, retain_cutoff: 'someday' }).detail).toBe(
        VERIFY_DETAIL.pruned_before_cutoff,
      );
      expect(chainOf(second, 'pruned').detail).toBe(VERIFY_DETAIL.previous_missing);
      expect(chainOf(second, { pruned: false, retain_cutoff: kept.retain_cutoff }).detail).toBe(
        VERIFY_DETAIL.previous_mismatch,
      );
    });
  });

  it('missing, mismatching or foreign previous records fail with a named detail', () => {
    expect(chainOf(second, null).detail).toBe(VERIFY_DETAIL.previous_missing);
    expect(chainOf(second, undefined).detail).toBe(VERIFY_DETAIL.previous_missing);
    expect(chainOf(second, 'something else').detail).toBe(VERIFY_DETAIL.previous_missing);
    expect(chainOf(second, 42).detail).toBe(VERIFY_DETAIL.previous_missing);
    expect(chainOf(second, [first]).detail).toBe(VERIFY_DETAIL.previous_missing);
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
    const serve = verify(serveRecord(), RING, { storedCreativeHash: STORED_CREATIVE_HASH });
    expect(checkOf(serve, 'separation_attested')).toEqual({
      name: 'separation_attested',
      ok: false,
      detail: 'not attested',
    });
    expect(serve.valid).toBe(false);
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

  it('is ok for an unattested record when its superseding attestation is handed in', () => {
    const { original, attested } = attestedPair();
    const result = verify(original, RING, {
      prevRecord: null,
      storedCreativeHash: STORED_CREATIVE_HASH,
      supersededBy: attested,
    });
    expect(checkOf(result, 'separation_attested')).toEqual({
      name: 'separation_attested',
      ok: true,
      detail: VERIFY_DETAIL.attested_by_superseding,
    });
    expect(result.valid).toBe(true);
    const suppressed = attestedPair(suppressRecord());
    const check = checkOf(
      verify(suppressed.original, RING, { prevRecord: null, supersededBy: suppressed.attested }),
      'separation_attested',
    );
    expect(check.detail).toBe(VERIFY_DETAIL.attested_by_superseding);
  });

  it('ignores a supersededBy that does not attest exactly this record', () => {
    const { original, attested } = attestedPair();
    const other = attestedPair(serveRecord({ id: 'aud_01JOTHER' })).attested;
    const impostors: unknown[] = [
      other,
      { ...attested, supersedes_hash: flipLastHexDigit(original.record_hash) },
      { ...attested, id: 'aud_01JOTHERID' },
      { ...attested, app_id: 'app_01JOTHERAPP' },
      { ...attested, separation_attestation: false },
      { ...attested, model_output_hash: null },
      { ...attested, attested_at: null },
      null,
      'attested',
      42,
      [attested],
    ];
    for (const by of impostors) {
      const check = checkOf(
        verify(original, RING, {
          prevRecord: null,
          storedCreativeHash: STORED_CREATIVE_HASH,
          supersededBy: by as AuditRecord,
        }),
        'separation_attested',
      );
      expect(check.ok, JSON.stringify(by)).toBe(false);
      expect(check.detail).toBe(VERIFY_DETAIL.not_attested);
    }
  });
});
