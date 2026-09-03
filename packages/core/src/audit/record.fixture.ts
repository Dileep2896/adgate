import type {
  Candidate,
  Classification,
  DemandTrace,
  Disclosure,
  PolicyDecision,
  Surface,
  SuppressReason,
} from '@adgate/schemas';

import { sha256Prefixed } from './crypto.js';
import { TEST_KEYS } from './crypto.fixture.js';
import type { BuildAuditRecordInput } from './record.js';

/**
 * Test fixture (not exported from the package): a buildAuditRecord input that serves under the
 * docs/audit.md example values. Tests patch one field at a time. Nothing here is a secret.
 */
export const APP = { app_id: 'app_01JTESTAPP', salt: 'per-app-salt' };
export const CONVERSATION_ID = 'conv_abc';
export const RAW_USER_ID = 'user_42';
export const TS = '2026-09-02T18:04:11Z';
export const POLICY_HASH = sha256Prefixed('test-policy');

/** The docs/api.md example classification. */
export const SERVE_CLASSIFICATION: Classification = {
  commercial_intent: 0.84,
  categories: ['software.devtools.database'],
  sensitive: [],
  confidence: 0.91,
  method: 'llm',
  prompt_version: 'sha256:test-prompt',
};

export const CHAT_SURFACE: Surface = { type: 'chat', placement: 'after_answer', max_creatives: 1 };

export const DISCLOSURE: Disclosure = {
  label: 'Sponsored',
  position: 'after_answer',
  style: 'separate_block',
};

/** The docs/audit.md policy_decisions block. */
export const SERVE_DECISIONS: PolicyDecision[] = [
  { rule: 'serve_to_tiers', result: 'pass' },
  { rule: 'regions', result: 'pass' },
  { rule: 'blocked_categories', result: 'pass' },
  { rule: 'min_confidence', result: 'pass' },
  { rule: 'min_commercial_intent', result: 'pass' },
  { rule: 'frequency_caps', result: 'pass', detail: 'session=0/1 day=1/3 turns_since=9' },
  { rule: 'competitor_exclusions', result: 'pending' },
];

/** What the engine records for a paid user under the default policy. */
export const PAID_USER_DECISIONS: PolicyDecision[] = [
  { rule: 'serve_to_tiers', result: 'fail', detail: 'tier=paid not in serve_to_tiers' },
  ...SERVE_DECISIONS.slice(1),
];

/** The docs/audit.md creative, as a DirectAdapter candidate. */
export const EXAMPLE_CANDIDATE: Candidate = {
  id: 'cr_01JEXAMPLEDB',
  advertiser: 'Example DB Cloud',
  advertiser_domain: 'example.com',
  headline: 'Managed Postgres with a free tier',
  body: 'Spin up a database in 30 seconds.',
  cta: 'Try it free',
  url_template: 'https://example.com/?ref=adgate',
  target_categories: ['software.devtools.database'],
  target_regions: [],
  keywords: ['postgres'],
  ecpm: 5,
  source: 'direct',
  active: true,
  ecpm_estimate: 5,
  targeting_match: 0.85,
  resolved_url: 'https://example.com/?ref=adgate',
};

/** The docs/audit.md demand block. */
export const SERVE_TRACE: DemandTrace = {
  requested: ['direct', 'affiliate'],
  responses: [
    { source: 'direct', candidates: 2, latency_ms: 38 },
    { source: 'affiliate', candidates: 0, latency_ms: 61 },
  ],
  excluded: [],
  selected: 'direct',
};

export const NO_FILL_TRACE: DemandTrace = {
  requested: ['direct'],
  responses: [{ source: 'direct', candidates: 0, latency_ms: 3 }],
  excluded: [],
  selected: null,
};

export const serveInput = (patch: Partial<BuildAuditRecordInput> = {}): BuildAuditRecordInput => ({
  id: 'aud_01JFIRSTRECORD',
  app: APP,
  conversation_id: CONVERSATION_ID,
  turn_id: 'turn_7',
  ts: TS,
  surface: CHAT_SURFACE,
  classification: SERVE_CLASSIFICATION,
  policy: { policy_version: 1, policy_hash: POLICY_HASH, disclosure: DISCLOSURE },
  policyResult: { allowed: true, reason: null, decisions: SERVE_DECISIONS },
  mediation: { selected: EXAMPLE_CANDIDATE, trace: SERVE_TRACE },
  prev_hash: 'genesis',
  signing: { key_id: TEST_KEYS.key_id, private_pem: TEST_KEYS.private_pem },
  ...patch,
});

/** A policy suppression: demand never ran, so mediation is null. */
export const suppressInput = (
  reason: SuppressReason | null,
  decisions: PolicyDecision[] = PAID_USER_DECISIONS,
  patch: Partial<BuildAuditRecordInput> = {},
): BuildAuditRecordInput =>
  serveInput({ policyResult: { allowed: false, reason, decisions }, mediation: null, ...patch });
