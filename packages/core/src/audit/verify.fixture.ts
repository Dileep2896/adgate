import type { AuditRecord, VerifyCheck, VerifyCheckName, VerifyResponse } from '@adgate/schemas';

import { attest } from './attest.js';
import { nextPrevHash } from './chain.js';
import { creativeContentHash } from './content-hash.js';
import { sha256Prefixed } from './crypto.js';
import { OTHER_KEYS, TEST_KEYS } from './crypto.fixture.js';
import { createKeyRing } from './keys.js';
import { buildAuditRecord, type BuildAuditRecordInput } from './record.js';
import { EXAMPLE_CANDIDATE, serveInput, suppressInput } from './record.fixture.js';

/**
 * Shared material for the attest and verify tests (a non-test module so importing it does not
 * re-register tests). Records are built with S14's buildAuditRecord under the S13 test keys.
 */
export const SIGNING = { key_id: TEST_KEYS.key_id, private_pem: TEST_KEYS.private_pem };
export const OTHER_SIGNING = { key_id: OTHER_KEYS.key_id, private_pem: OTHER_KEYS.private_pem };

/** Holds both test keys, as a gateway ring does after a rotation. */
export const RING = createKeyRing({
  [TEST_KEYS.key_id]: TEST_KEYS.public_pem,
  [OTHER_KEYS.key_id]: OTHER_KEYS.public_pem,
});

/** What S20 computes over the creatives row for the docs example creative. */
export const STORED_CREATIVE_HASH = creativeContentHash(EXAMPLE_CANDIDATE);
export const MODEL_OUTPUT_HASH = sha256Prefixed('the model answer, rendered before the slot');
export const ATTESTED_AT = '2026-09-02T18:04:13Z';

export const serveRecord = (patch: Partial<BuildAuditRecordInput> = {}): AuditRecord =>
  buildAuditRecord(serveInput(patch));

export const suppressRecord = (patch: Partial<BuildAuditRecordInput> = {}): AuditRecord =>
  buildAuditRecord(suppressInput('frequency_cap', undefined, patch));

/** A serve record and its attestation, chained right after it (the common case). */
export const attestedPair = (
  original: AuditRecord = serveRecord(),
): { original: AuditRecord; attested: AuditRecord } => ({
  original,
  attested: attest(original, MODEL_OUTPUT_HASH, ATTESTED_AT, {
    prev_hash: nextPrevHash(original),
    signing: SIGNING,
  }),
});

export const checkOf = (response: VerifyResponse, name: VerifyCheckName): VerifyCheck => {
  const found = response.checks.find((check) => check.name === name);
  if (found === undefined) {
    throw new Error(`no ${name} check in ${JSON.stringify(response)}`);
  }
  return found;
};

export const failedNames = (response: VerifyResponse): VerifyCheckName[] =>
  response.checks.filter((check) => !check.ok).map((check) => check.name);

export const CHECK_NAMES: VerifyCheckName[] = [
  'schema',
  'record_hash',
  'chain',
  'signature',
  'creative_hash',
  'disclosure_present',
  'separation_attested',
  'supersedes',
];
