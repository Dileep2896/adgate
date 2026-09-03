import {
  type BuildAuditRecordInput,
  buildAuditBody,
  buildAuditRecord,
  type ClassifyLlmFailure,
  type ClassifySource,
  classify,
  classifyCacheKey,
  conversationIdHash,
  evaluatePolicy,
  failClosedClassification,
  GENESIS,
  latencySince,
  type MediationResult,
  mediate,
  mergeOverrides,
  nextPrevHash,
  policyHash,
  prefixedUlid,
  prepareText,
  userHash,
} from '@adgate/core';
import {
  type Classification,
  type DemandRequest,
  Disclosure,
  type EvaluateRequest,
  type EvaluateResponse,
} from '@adgate/schemas';
import type { Logger } from 'pino';

import type { AppRow } from '../db/tables/apps.js';
import { utcDay } from './caps.js';
import type { CacheSource } from './classify-cache-pg.js';
import type { EvaluateDeps } from './deps.js';
import { buildEvaluateResponse, errorEvaluateResponse } from './response.js';

/**
 * The evaluate pipeline (docs/architecture.md "Request lifecycle"), after auth and body
 * validation: stored policy + stricter-only overrides -> identity hashes -> cap state ->
 * classification (Postgres cache, LRU, rules, LLM) -> policy engine -> mediation when allowed
 * -> signed audit record chained to the app's latest -> one transaction (record, caps, raw
 * text) -> the response derived from the record. evaluate() wraps it all: ANY throw or timeout
 * becomes HTTP 200 { decision: suppress, reason: error } with a fail-closed record of its own,
 * and if even that record cannot be written the response still carries a fresh audit_id
 * (logged: that id has no record). Nothing here logs message text.
 */
export const AUDIT_ID_PREFIX = 'aud_';

export interface EvaluateContext {
  app: AppRow;
  request: EvaluateRequest;
  log: Logger;
  /** deps.now() when the request arrived, for latency_ms. */
  started: number;
}

/** What the route logs about an evaluation. Identifiers and enums only, never content. */
export interface EvaluateDiagnostics {
  classify_source?: ClassifySource;
  cache_source?: CacheSource;
  llm_failure?: ClassifyLlmFailure;
  error_name?: string;
  /** false only when the error path could not write its record either. */
  persisted: boolean;
  seq?: number;
}

export interface EvaluateResult {
  response: EvaluateResponse;
  diagnostics: EvaluateDiagnostics;
}

const errorName = (error: unknown): string =>
  error instanceof Error && error.name !== '' ? error.name : 'NonError';

const demandRequestOf = (
  app: AppRow,
  request: EvaluateRequest,
  classification: Classification,
  keywords: string[],
): DemandRequest => ({
  app_id: app.id,
  classification,
  surface: request.surface,
  user: {
    ...(request.user.region === undefined ? {} : { region: request.user.region }),
    ...(request.user.locale === undefined ? {} : { locale: request.user.locale }),
  },
  exclusions: [],
  keywords,
});

const runPipeline = async (deps: EvaluateDeps, ctx: EvaluateContext): Promise<EvaluateResult> => {
  const { app, request, log } = ctx;
  const now = deps.now;

  // 2. Policy: the stored document, then request overrides (stricter only; the rest rejected).
  const stored = deps.policies.load(app);
  const { policy, rejected } = mergeOverrides(stored, request.policy_overrides ?? {});
  const effectiveHash = policyHash(policy);

  // 3. Identity hashes and cap state. Raw ids never leave this function.
  const conversationHash = conversationIdHash(app.salt, request.conversation_id);
  const user_hash = userHash(app.salt, request.user.user_hash);
  const day = utcDay(now());
  const capState = await deps.caps.read({
    appId: app.id,
    conversationHash,
    userHash: user_hash,
    day,
  });

  // 4. Classification: the same prepared text is cached, classified and (only when allowed) stored.
  const prepared = prepareText(request);
  const cache = await deps.classifyCache.open(classifyCacheKey(prepared.text, policy), log);
  const outcome = await classify(request, {
    llm: deps.llm,
    cache: cache.cache,
    policy,
    timeoutMs: deps.classifierTimeoutMs,
    now,
  });
  const { classification } = outcome;

  // 5. Policy engine; 6. mediation only when every rule passed.
  const policyResult = evaluatePolicy({
    classification,
    user: request.user,
    policy,
    capState,
    surface: request.surface,
  });
  let mediation: MediationResult | null = null;
  let advertiserId: string | null = null;
  if (policyResult.allowed) {
    const { adapters, advertiserIds } = await deps.adapters.build({ app, policy, log });
    mediation = await mediate(
      adapters,
      demandRequestOf(app, request, classification, outcome.keywords),
      policy,
      { timeoutMs: deps.demandTimeoutMs, now },
    );
    if (mediation.selected !== null) {
      advertiserId = advertiserIds.get(mediation.selected.id) ?? null;
    }
  }

  // 7. The record. Its body (and the response) is fixed before persisting, so a response that
  // breaks the contract fails closed without leaving a serve record behind.
  const base: Omit<BuildAuditRecordInput, 'prev_hash'> = {
    id: prefixedUlid(AUDIT_ID_PREFIX, { now }),
    app: { app_id: app.id, salt: app.salt },
    conversation_id: request.conversation_id,
    user_hash: request.user.user_hash,
    turn_id: request.turn_id,
    ts: new Date(now()).toISOString(),
    surface: request.surface,
    classification,
    policy: {
      policy_version: app.policyVersion,
      policy_hash: effectiveHash,
      disclosure: policy.disclosure,
    },
    policyResult,
    override_rejected: rejected,
    mediation,
    signing: deps.signing,
  };
  const responseInput = {
    selected: mediation?.selected ?? null,
    selectedSource: mediation?.selected_source ?? null,
    publicBaseUrl: deps.publicBaseUrl,
    disclosureLabel: policy.disclosure.label,
  };
  buildEvaluateResponse({
    ...responseInput,
    record: buildAuditBody({ ...base, prev_hash: GENESIS }),
    latencyMs: 0,
  });

  // 8. Persist (chain position taken under the app lock), then respond from the stored record.
  const persisted = await deps.auditStore.persist({
    appId: app.id,
    build: (previous) => buildAuditRecord({ ...base, prev_hash: nextPrevHash(previous) }),
    caps: { conversationHash, userHash: user_hash, day, now: new Date(now()) },
    advertiserId,
    rawText: policy.privacy.store_raw_text ? prepared.text : null,
  });
  await cache.flush();
  const response = buildEvaluateResponse({
    ...responseInput,
    record: persisted.record,
    latencyMs: latencySince(now, ctx.started),
  });
  return {
    response,
    diagnostics: {
      classify_source: outcome.source,
      cache_source: cache.source,
      ...(outcome.llm_failure === undefined ? {} : { llm_failure: outcome.llm_failure }),
      ...(outcome.error_name === undefined ? {} : { error_name: outcome.error_name }),
      persisted: true,
      seq: persisted.seq,
    },
  };
};

/** The policy's disclosure for the error record, or the documented default when unreadable. */
const disclosureOf = (deps: EvaluateDeps, app: AppRow): Disclosure => {
  try {
    return deps.policies.load(app).disclosure;
  } catch {
    return Disclosure.parse({});
  }
};

/**
 * The fail-closed path: a suppress/error record built from the zeroed classification, chained
 * and signed like any other, and the documented error response. Logs the error's name only.
 */
const failClosed = async (
  deps: EvaluateDeps,
  ctx: EvaluateContext,
  error: unknown,
): Promise<EvaluateResult> => {
  const { app, request, log } = ctx;
  const error_name = errorName(error);
  log.error({ error_name }, 'evaluate failed; suppressing with reason error');
  const now = deps.now;
  const auditId = prefixedUlid(AUDIT_ID_PREFIX, { now });
  const latency = () => latencySince(now, ctx.started);
  try {
    const base: Omit<BuildAuditRecordInput, 'prev_hash'> = {
      id: auditId,
      app: { app_id: app.id, salt: app.salt },
      conversation_id: request.conversation_id,
      user_hash: request.user.user_hash,
      turn_id: request.turn_id,
      ts: new Date(now()).toISOString(),
      surface: request.surface,
      classification: failClosedClassification(),
      policy: {
        policy_version: app.policyVersion,
        policy_hash: app.policyHash,
        disclosure: disclosureOf(deps, app),
      },
      policyResult: { allowed: false, reason: 'error', decisions: [] },
      mediation: null,
      signing: deps.signing,
    };
    const persisted = await deps.auditStore.persist({
      appId: app.id,
      build: (previous) => buildAuditRecord({ ...base, prev_hash: nextPrevHash(previous) }),
      caps: {
        conversationHash: conversationIdHash(app.salt, request.conversation_id),
        userHash: userHash(app.salt, request.user.user_hash),
        day: utcDay(now()),
        now: new Date(now()),
      },
      advertiserId: null,
      rawText: null,
    });
    return {
      response: errorEvaluateResponse(persisted.record.id, latency()),
      diagnostics: { error_name, persisted: true, seq: persisted.seq },
    };
  } catch (persistError) {
    log.error(
      { error_name: errorName(persistError), audit_id: auditId },
      'audit record not persisted; the returned audit_id has no record',
    );
    return {
      response: errorEvaluateResponse(auditId, latency()),
      diagnostics: { error_name, persisted: false },
    };
  }
};

/** Runs the pipeline and never rejects: every failure is the documented suppress/error answer. */
export const evaluate = async (
  deps: EvaluateDeps,
  ctx: EvaluateContext,
): Promise<EvaluateResult> => {
  try {
    return await runPipeline(deps, ctx);
  } catch (error) {
    return failClosed(deps, ctx, error);
  }
};
