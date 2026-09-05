import { randomBytes } from 'node:crypto';

import {
  attest,
  type AuditSigningKey,
  buildAuditRecord,
  createKeyRing,
  creativeContentHash,
  derivePublicPem,
  generateKeypair,
  loadPolicyFromYaml,
  nextPrevHash,
  prefixedUlid,
  sha256Prefixed,
} from '@adgate/core';
import type {
  AuditRecord,
  Candidate,
  Classification,
  DemandTrace,
  PolicyDecision,
  SuppressReason,
  Surface,
} from '@adgate/schemas';
import type { Sql } from 'postgres';

import type { VerifyKeys } from './verify-keys';

/**
 * REAL signed audit records for the integration tests. Test-only: nothing in the app imports
 * this (the dashboard never writes - lib/db.ts).
 *
 * The records are built with core's buildAuditRecord and signed with a keypair generated per
 * run, chained the way packages/gateway/src/evaluate/audit-store.ts chains them: seq 1, 2,
 * 3..., prev_hash = the previous record's record_hash, ts increasing with seq. That matters
 * because the whole point of these tests is what verify() says, and verify() only says anything
 * useful about a record that was genuinely hashed and signed - a fixture with a placeholder
 * `{}` record (which is all the metric fixtures need) would fail every check for the wrong
 * reason.
 */

export const CREATIVE_ID = 'cr_audit_fixture';
export const ADVERTISER_ID = 'adv_audit_fixture';
export const ADVERTISER_NAME = 'Audit Fixture Co';
export const ADVERTISER_DOMAIN = 'auditfixture.example';
export const HEADLINE = 'Managed Postgres with a free tier';

/** The catalog row every serve in the fixture points at, as the demand path would hand it over. */
export const FIXTURE_CANDIDATE: Candidate = {
  id: CREATIVE_ID,
  advertiser: ADVERTISER_NAME,
  advertiser_domain: ADVERTISER_DOMAIN,
  headline: HEADLINE,
  body: 'Spin up a database in 30 seconds.',
  cta: 'Try it free',
  url_template: `https://${ADVERTISER_DOMAIN}/?ref=adgate`,
  target_categories: ['software.devtools.database'],
  target_regions: [],
  keywords: ['postgres'],
  ecpm: 20,
  source: 'direct',
  active: true,
  ecpm_estimate: 20,
  targeting_match: 0.85,
  resolved_url: `https://${ADVERTISER_DOMAIN}/?ref=adgate`,
};

/** content_hash of the fixture creative: the value the catalog row and the record both carry. */
export const FIXTURE_CONTENT_HASH = creativeContentHash(FIXTURE_CANDIDATE);

const CLASSIFICATION: Classification = {
  commercial_intent: 0.84,
  categories: ['software.devtools.database'],
  sensitive: [],
  confidence: 0.91,
  method: 'rules',
  prompt_version: sha256Prefixed('audit-fixture-prompt'),
};

const SURFACE: Surface = { type: 'chat', placement: 'after_answer', max_creatives: 1 };

const PASS_DECISIONS: PolicyDecision[] = [
  { rule: 'serve_to_tiers', result: 'pass' },
  { rule: 'regions', result: 'pass' },
  { rule: 'blocked_categories', result: 'pass' },
  { rule: 'min_confidence', result: 'pass' },
  { rule: 'min_commercial_intent', result: 'pass' },
  { rule: 'frequency_caps', result: 'pass', detail: 'session=0/1 day=1/3 turns_since=9' },
  { rule: 'competitor_exclusions', result: 'pending' },
];

type PolicyRuleName = PolicyDecision['rule'];

const failDecisions = (rule: PolicyRuleName, detail: string): PolicyDecision[] => [
  { rule: PASS_DECISIONS[0]!.rule, result: 'pass' },
  { rule, result: 'fail', detail },
  ...PASS_DECISIONS.slice(2),
];

const SERVE_TRACE: DemandTrace = {
  requested: ['direct'],
  responses: [{ source: 'direct', candidates: 1, latency_ms: 12 }],
  excluded: [],
  selected: 'direct',
};

const NO_FILL_TRACE: DemandTrace = {
  requested: ['direct'],
  responses: [{ source: 'direct', candidates: 0, latency_ms: 3 }],
  excluded: [],
  selected: null,
};

/** One turn to write: a serve, a no_fill, or a policy suppression with its reason. */
export type SeedTurn = 'serve' | 'no_fill' | { suppress: SuppressReason; rule?: PolicyRuleName };

export interface SeedAuditChainOptions {
  turns: readonly SeedTurn[];
  appName?: string;
  /** The first record's ts; each later record is one minute after the previous one. */
  start?: Date;
  /**
   * Sign with this key instead of a freshly generated one. The Playwright fixture passes the
   * gateway's own key, because the dashboard under test verifies with the ring its environment
   * gives it and the two have to be the same key.
   */
  signing?: AuditSigningKey;
}

export interface SeededAuditChain {
  appId: string;
  appName: string;
  signing: AuditSigningKey;
  /** The ring the dashboard must verify with; hand it to loadAuditDetail as `keys`. */
  keys: VerifyKeys;
  /** The stored records, in seq order (seq = index + 1). */
  records: AuditRecord[];
}

const generatedKey = (): AuditSigningKey => {
  const keypair = generateKeypair();
  return { key_id: keypair.key_id, private_pem: keypair.private_pem };
};

const policyYaml = (appId: string): string => `version: 1\napp_id: ${appId}\n`;

const TURN_INTERVAL_MS = 60_000;

/** Inserts the app, its advertiser and creative, and one signed record per turn. */
export const seedAuditChain = async (
  sql: Sql,
  options: SeedAuditChainOptions,
): Promise<SeededAuditChain> => {
  const appId = prefixedUlid('app_');
  const appName = options.appName ?? 'Audit fixture app';
  const salt = randomBytes(32).toString('hex');
  const yaml = policyYaml(appId);
  const { policy, policy_hash } = loadPolicyFromYaml(yaml);
  const signing = options.signing ?? generatedKey();
  const pems = { [signing.key_id]: derivePublicPem(signing.private_pem) };
  const ring = createKeyRing(pems);

  await sql`
    insert into apps (id, name, salt, policy_yaml, policy_hash, policy_version)
    values (${appId}, ${appName}, ${salt}, ${yaml}, ${policy_hash}, 1)
  `;
  await sql`
    insert into advertisers (id, name, domain)
    values (${ADVERTISER_ID}, ${ADVERTISER_NAME}, ${ADVERTISER_DOMAIN})
    on conflict (id) do nothing
  `;
  await sql`
    insert into creatives (id, advertiser_id, headline, body, cta, url_template,
      target_categories, target_regions, keywords, ecpm, source, content_hash)
    values (${CREATIVE_ID}, ${ADVERTISER_ID}, ${FIXTURE_CANDIDATE.headline},
      ${FIXTURE_CANDIDATE.body}, ${FIXTURE_CANDIDATE.cta}, ${FIXTURE_CANDIDATE.url_template},
      ${sql.array([...FIXTURE_CANDIDATE.target_categories])},
      ${sql.array([...FIXTURE_CANDIDATE.target_regions])},
      ${sql.array([...FIXTURE_CANDIDATE.keywords])},
      ${FIXTURE_CANDIDATE.ecpm}, 'direct',
      ${FIXTURE_CONTENT_HASH})
    on conflict (id) do nothing
  `;

  const start = options.start ?? new Date(Date.now() - options.turns.length * TURN_INTERVAL_MS);
  const records: AuditRecord[] = [];
  let previous: AuditRecord | null = null;

  for (const [index, turn] of options.turns.entries()) {
    const ts = new Date(start.getTime() + index * TURN_INTERVAL_MS);
    const record = buildAuditRecord({
      id: prefixedUlid('aud_'),
      app: { app_id: appId, salt },
      conversation_id: `conv_${index}`,
      turn_id: `turn_${index + 1}`,
      ts: ts.toISOString(),
      surface: SURFACE,
      classification: CLASSIFICATION,
      policy: { policy_version: 1, policy_hash, disclosure: policy.disclosure },
      ...outcomeOf(turn),
      prev_hash: nextPrevHash(previous),
      signing,
    });
    await insertRecord(sql, appId, index + 1, ts, record);
    records.push(record);
    previous = record;
  }

  return { appId, appName, signing, keys: { ring, issue: null, pems }, records };
};

const outcomeOf = (turn: SeedTurn) => {
  if (turn === 'serve') {
    return {
      policyResult: { allowed: true, reason: null, decisions: PASS_DECISIONS },
      mediation: { selected: FIXTURE_CANDIDATE, trace: SERVE_TRACE },
    } as const;
  }
  if (turn === 'no_fill') {
    return {
      policyResult: { allowed: true, reason: null, decisions: PASS_DECISIONS },
      mediation: { selected: null, trace: NO_FILL_TRACE },
    } as const;
  }
  const rule = turn.rule ?? 'blocked_categories';
  return {
    policyResult: {
      allowed: false,
      reason: turn.suppress,
      decisions: failDecisions(rule, turn.suppress),
    },
    mediation: null,
  } as const;
};

export const insertRecord = async (
  sql: Sql,
  appId: string,
  seq: number,
  ts: Date,
  record: AuditRecord,
  options: { isLatest?: boolean; attestRendered?: boolean | null } = {},
): Promise<void> => {
  await sql`
    insert into audit_records (record_hash, id, app_id, seq, prev_hash, supersedes_hash,
      is_latest, decision, reason, creative_id, advertiser_id, ts, record, attest_rendered)
    values (${record.record_hash}, ${record.id}, ${appId}, ${seq}, ${record.prev_hash},
      ${record.supersedes_hash}, ${options.isLatest ?? true}, ${record.decision}, ${record.reason},
      ${record.creative?.id ?? null}, ${record.creative === null ? null : ADVERTISER_ID},
      ${ts.toISOString()}, ${sql.json(record)},
      ${options.attestRendered ?? null})
  `;
};

/**
 * One event against a seeded turn, the way POST /v1/event writes it (S19). Events are keyed by
 * the AUDIT ID, so an attested turn's impression stays attached to it through attestation.
 */
export const insertEvent = async (
  sql: Sql,
  appId: string,
  auditId: string,
  type: 'impression' | 'click' | 'dismiss' | 'conversion',
  ts: Date = new Date(),
): Promise<void> => {
  await sql`
    insert into events (id, audit_id, app_id, type, ts)
    values (${prefixedUlid('ev_')}, ${auditId}, ${appId}, ${type}, ${ts.toISOString()})
  `;
};

/**
 * Attests the record at `seq`, exactly as POST /v1/attest does: a NEW row with the same audit
 * id at the next chain position, the old row demoted to is_latest false.
 */
export const attestRecord = async (
  sql: Sql,
  chain: SeededAuditChain,
  seq: number,
  now: Date = new Date(),
): Promise<AuditRecord> => {
  const original = chain.records[seq - 1];
  if (original === undefined) {
    throw new Error(`no seeded record at seq ${seq}`);
  }
  const latest = chain.records[chain.records.length - 1] ?? null;
  const attested = attest(original, sha256Prefixed('model output'), now.toISOString(), {
    prev_hash: nextPrevHash(latest),
    signing: chain.signing,
  });
  await sql`update audit_records set is_latest = false where record_hash = ${original.record_hash}`;
  await insertRecord(sql, chain.appId, chain.records.length + 1, now, attested, {
    attestRendered: true,
  });
  chain.records.push(attested);
  return attested;
};
