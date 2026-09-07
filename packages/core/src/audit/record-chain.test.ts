import { AuditRecord, type UnsignedAuditRecord } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { evaluatePolicy } from '../policy/evaluate.js';
import { serveInput as policyServeInput } from '../policy/evaluate.fixture.js';
import { computeRecordHash, nextPrevHash, unsignedOf } from './chain.js';
import { sha256Prefixed } from './crypto.js';
import { flipLastHexDigit, OTHER_KEYS, TEST_KEYS } from './crypto.fixture.js';
import { createKeyRing } from './keys.js';
import { buildAuditRecord } from './record.js';
import { serveInput, suppressInput } from './record.fixture.js';

const ring = createKeyRing({
  [TEST_KEYS.key_id]: TEST_KEYS.public_pem,
  [OTHER_KEYS.key_id]: OTHER_KEYS.public_pem,
});

describe('hash chain', () => {
  const first = buildAuditRecord(serveInput());
  const second = buildAuditRecord(
    suppressInput('frequency_cap', undefined, {
      id: 'aud_01JSECONDRECORD',
      turn_id: 'turn_8',
      prev_hash: nextPrevHash(first),
    }),
  );

  it('starts at genesis and links each record to the previous record_hash', () => {
    expect(first.prev_hash).toBe('genesis');
    expect(second.prev_hash).toBe(first.record_hash);
    expect(second.record_hash).not.toBe(first.record_hash);
    expect(AuditRecord.parse(second)).toEqual(second);
  });

  it('stores a record_hash that recomputes from the record itself', () => {
    expect(computeRecordHash(first)).toBe(first.record_hash);
    expect(computeRecordHash(second)).toBe(second.record_hash);
  });

  it('signs the record_hash under key_id so the S13 ring verifies it', () => {
    for (const record of [first, second]) {
      expect(ring.verify(record.record_hash, record.signature, record.key_id)).toEqual({
        ok: true,
        detail: `key_id=${TEST_KEYS.key_id}`,
      });
      expect(ring.verify(record.record_hash, record.signature, OTHER_KEYS.key_id).ok).toBe(false);
    }
    expect(ring.verify(second.record_hash, first.signature, second.key_id).ok).toBe(false);
  });

  it('supports rotation: a later record under a new key_id verifies next to the old one', () => {
    const third = buildAuditRecord(
      serveInput({
        id: 'aud_01JTHIRDRECORD',
        prev_hash: nextPrevHash(second),
        signing: { key_id: OTHER_KEYS.key_id, private_pem: OTHER_KEYS.private_pem },
      }),
    );
    expect(third.key_id).toBe('k_other');
    expect(third.prev_hash).toBe(second.record_hash);
    expect(ring.verify(third.record_hash, third.signature, third.key_id).ok).toBe(true);
    expect(ring.verify(second.record_hash, second.signature, second.key_id).ok).toBe(true);
  });

  it('is deterministic: the same input builds the identical record', () => {
    expect(buildAuditRecord(serveInput())).toEqual(first);
  });

  it('differs per id, so two evaluations never share a record_hash', () => {
    const other = buildAuditRecord(serveInput({ id: 'aud_01JOTHERRECORD' }));
    expect(other.record_hash).not.toBe(first.record_hash);
    expect(other.signature).not.toBe(first.signature);
  });
});

type Tamper = (record: UnsignedAuditRecord) => void;

/** One mutation per field of the unsigned record; a new field must be added here too. */
const TAMPERS: Record<keyof UnsignedAuditRecord, Tamper> = {
  id: (r) => {
    r.id = 'aud_01JTAMPERED';
  },
  app_id: (r) => {
    r.app_id = 'app_01JOTHERAPP';
  },
  conversation_id_hash: (r) => {
    r.conversation_id_hash = flipLastHexDigit(r.conversation_id_hash);
  },
  user_hash: (r) => {
    r.user_hash = sha256Prefixed('someone else');
  },
  turn_id: (r) => {
    r.turn_id = 'turn_8';
  },
  ts: (r) => {
    r.ts = '2026-09-02T18:04:12Z';
  },
  surface: (r) => {
    r.surface = { ...r.surface, type: 'cli' };
  },
  classification: (r) => {
    r.classification = { ...r.classification, sensitive: ['health'] };
  },
  policy_version: (r) => {
    r.policy_version += 1;
  },
  policy_hash: (r) => {
    r.policy_hash = flipLastHexDigit(r.policy_hash);
  },
  policy_decisions: (r) => {
    r.policy_decisions = r.policy_decisions.map((decision) =>
      decision.rule === 'regions' ? { ...decision, result: 'fail' } : decision,
    );
  },
  override_rejected: (r) => {
    r.override_rejected = [...r.override_rejected, { path: 'x', reason: 'y' }];
  },
  decision: (r) => {
    r.decision = 'suppress';
  },
  reason: (r) => {
    r.reason = 'no_fill';
  },
  demand: (r) => {
    r.demand = { ...r.demand, selected: 'affiliate' };
  },
  creative: (r) => {
    if (r.creative !== null) {
      r.creative = { ...r.creative, content_hash: flipLastHexDigit(r.creative.content_hash) };
    }
  },
  disclosure: (r) => {
    r.disclosure = { ...r.disclosure, label: 'Ad' };
  },
  model_output_hash: (r) => {
    r.model_output_hash = sha256Prefixed('model output');
  },
  separation_attestation: (r) => {
    r.separation_attestation = true;
  },
  attested_at: (r) => {
    r.attested_at = '2026-09-02T18:05:00Z';
  },
  supersedes_hash: (r) => {
    r.supersedes_hash = sha256Prefixed('prior');
  },
  prev_hash: (r) => {
    r.prev_hash = sha256Prefixed('elsewhere');
  },
  key_id: (r) => {
    r.key_id = 'k_other';
  },
};

describe('tampering', () => {
  const record = buildAuditRecord(serveInput());

  it('covers every field of the unsigned record', () => {
    expect(Object.keys(TAMPERS).sort()).toEqual(Object.keys(unsignedOf(record)).sort());
  });

  it.each(Object.keys(TAMPERS) as (keyof UnsignedAuditRecord)[])(
    'changing %s changes the recomputed hash and invalidates the signature',
    (field) => {
      const tampered = structuredClone(record);
      TAMPERS[field](tampered);
      expect(tampered).not.toEqual(record);
      const recomputed = computeRecordHash(tampered);
      expect(recomputed).not.toBe(record.record_hash);
      expect(ring.verify(recomputed, tampered.signature, tampered.key_id).ok).toBe(false);
    },
  );
});

describe('with the policy engine', () => {
  it('copies evaluatePolicy decisions verbatim into the record', () => {
    const evaluation = evaluatePolicy(policyServeInput());
    expect(evaluation.allowed).toBe(true);
    const record = buildAuditRecord(serveInput({ policyResult: evaluation }));
    expect(record.policy_decisions).toEqual(evaluation.decisions);
    expect(record.policy_decisions.map((d) => d.rule)).toEqual([
      'serve_to_tiers',
      'regions',
      'blocked_categories',
      'min_confidence',
      'min_commercial_intent',
      'frequency_caps',
      'competitor_exclusions',
    ]);
    expect(record.decision).toBe('serve');
    expect(AuditRecord.parse(record)).toEqual(record);
  });

  it('records a failing evaluation with its first failing reason', () => {
    const evaluation = evaluatePolicy(policyServeInput({ user: { tier: 'paid', region: 'US' } }));
    expect(evaluation.allowed).toBe(false);
    const record = buildAuditRecord(serveInput({ policyResult: evaluation, mediation: null }));
    expect(record.decision).toBe('suppress');
    expect(record.reason).toBe('paid_user');
    expect(record.policy_decisions).toEqual(evaluation.decisions);
    expect(record.policy_decisions[0]).toEqual({
      rule: 'serve_to_tiers',
      result: 'fail',
      detail: 'tier=paid not in serve_to_tiers',
    });
  });
});
