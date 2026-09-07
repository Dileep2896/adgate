import type { AuditRecord } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { nextPrevHash } from './chain.js';
import { sha256Prefixed } from './crypto.js';
import { flipLastHexDigit, OTHER_KEYS, tamperSignature } from './crypto.fixture.js';
import { verify } from './verify.js';
import { VERIFY_DETAIL } from './verify-checks.js';
import {
  attestedPair,
  CHECK_NAMES,
  checkOf,
  failedNames,
  RING,
  serveRecord,
  STORED_CREATIVE_HASH,
  suppressRecord,
} from './verify.fixture.js';

type Tamper = (record: AuditRecord) => void;

/**
 * Field -> mutation -> the checks that must fail (every other check must still pass). The record
 * under test is an attestation, so a body field edited after signing also fails `supersedes`:
 * the attestation is no longer a faithful copy of the record it supersedes.
 */
const TAMPER_MATRIX: { field: string; tamper: Tamper; fails: string[] }[] = [
  {
    field: 'classification',
    tamper: (r) => {
      r.classification = { ...r.classification, sensitive: ['health'] };
    },
    fails: ['record_hash', 'supersedes'],
  },
  {
    field: 'creative.content_hash',
    tamper: (r) => {
      if (r.creative !== null) {
        r.creative = { ...r.creative, content_hash: flipLastHexDigit(r.creative.content_hash) };
      }
    },
    fails: ['record_hash', 'creative_hash', 'supersedes'],
  },
  {
    field: 'creative.advertiser',
    tamper: (r) => {
      if (r.creative !== null) {
        r.creative = { ...r.creative, advertiser: 'Someone Else' };
      }
    },
    fails: ['record_hash', 'supersedes'],
  },
  {
    field: 'disclosure.label (blank)',
    tamper: (r) => {
      r.disclosure = { ...r.disclosure, label: ' ' };
    },
    fails: ['record_hash', 'disclosure_present', 'supersedes'],
  },
  {
    field: 'disclosure.label (renamed)',
    tamper: (r) => {
      r.disclosure = { ...r.disclosure, label: 'Ad' };
    },
    fails: ['record_hash', 'supersedes'],
  },
  {
    field: 'attested_at',
    tamper: (r) => {
      r.attested_at = '2026-09-02T18:04:14Z';
    },
    fails: ['record_hash'],
  },
  {
    field: 'prev_hash',
    tamper: (r) => {
      r.prev_hash = sha256Prefixed('elsewhere');
    },
    fails: ['record_hash', 'chain'],
  },
  {
    field: 'signature',
    tamper: (r) => {
      r.signature = tamperSignature(r.signature);
    },
    fails: ['signature'],
  },
  {
    field: 'record_hash',
    tamper: (r) => {
      r.record_hash = flipLastHexDigit(r.record_hash);
    },
    fails: ['record_hash', 'signature'],
  },
  {
    field: 'key_id (another ring key)',
    tamper: (r) => {
      r.key_id = OTHER_KEYS.key_id;
    },
    fails: ['record_hash', 'signature'],
  },
  {
    field: 'key_id (unknown)',
    tamper: (r) => {
      r.key_id = 'k_unknown';
    },
    fails: ['record_hash', 'signature'],
  },
  {
    field: 'decision (serve to suppress with a creative)',
    tamper: (r) => {
      r.decision = 'suppress';
      r.reason = 'no_fill';
    },
    fails: ['schema'],
  },
];

describe('verify tamper matrix', () => {
  const first = suppressRecord({ id: 'aud_01JFIRST' });
  const { original, attested } = attestedPair(
    serveRecord({ id: 'aud_01JSECOND', prev_hash: nextPrevHash(first) }),
  );
  const ctx = {
    prevRecord: original,
    storedCreativeHash: STORED_CREATIVE_HASH,
    supersededRecord: original,
    superseded: { prevRecord: first, storedCreativeHash: STORED_CREATIVE_HASH },
  };

  it('starts from a fully valid attested record', () => {
    expect(verify(attested, RING, ctx).valid).toBe(true);
  });

  it.each(TAMPER_MATRIX)('changing $field fails exactly $fails', ({ tamper, fails }) => {
    const tampered = structuredClone(attested);
    tamper(tampered);
    const result = verify(tampered, RING, ctx);
    expect(result.valid).toBe(false);
    expect(result.checks.map((check) => check.name)).toEqual(CHECK_NAMES);
    if (fails[0] === 'schema') {
      expect(failedNames(result)).toEqual(CHECK_NAMES);
    } else {
      expect(failedNames(result)).toEqual(fails);
    }
  });

  it('names the ring failure on the signature check', () => {
    const wrongKey = { ...attested, key_id: OTHER_KEYS.key_id };
    expect(checkOf(verify(wrongKey, RING, ctx), 'signature').detail).toBe('bad_signature');
    const unknown = { ...attested, key_id: 'k_unknown' };
    expect(checkOf(verify(unknown, RING, ctx), 'signature').detail).toBe('unknown_key_id');
  });

  it('an added field breaks record_hash: the record is hashed as loaded', () => {
    const extra = { ...attested, note: 'edited via SQL' };
    const result = verify(extra, RING, ctx);
    expect(failedNames(result)).toEqual(['record_hash']);
    expect(checkOf(result, 'schema').ok).toBe(true);
    expect(checkOf(result, 'record_hash').detail).toBe(VERIFY_DETAIL.hash_mismatch);
  });
});
