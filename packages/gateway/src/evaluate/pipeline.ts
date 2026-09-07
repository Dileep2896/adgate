import {
  type BuildAuditRecordInput,
  buildAuditBody,
  buildAuditRecord,
  classify,
  classifyCacheKey,
  conversationIdHash,
  type EvaluatePolicyInput,
  evaluatePolicy,
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
} from '@adgateio/core';
import type { Classification, DemandRequest, EvaluateRequest } from '@adgateio/schemas';

import type { AppRow } from '../db/tables/apps.js';
import { utcDay } from './caps.js';
import type { EvaluateDeps } from './deps.js';
import { AUDIT_ID_PREFIX, failClosed } from './fail-closed.js';
import { buildEvaluateResponse } from './response.js';
import type { EvaluateContext, EvaluateResult } from './types.js';

/**
 * The evaluate pipeline (docs/architecture.md "Request lifecycle"), after auth and body
 * validation: stored policy + stricter-only overrides -> identity hashes -> cap state ->
 * classification (Postgres cache, LRU, rules, LLM; both tiers keyed per app) -> policy engine
 * -> mediation when allowed -> signed audit record chained to the app's latest -> one
 * transaction (record, caps, raw text) in which the cap state is read again under the app lock
 * and the policy re-run on it, so a concurrent turn of the same conversation cannot make two
 * serves out of one cap -> the response derived from the persisted record. evaluate() wraps it
 * all: ANY throw or timeout becomes HTTP 200 { decision: suppress, reason: error } through
 * fail-closed.ts. Nothing here logs message text.
 */
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
  const stored = deps.policies.load(app, log);
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
  const cache = await deps.classifyCache.open(app.id, classifyCacheKey(prepared.text, policy), log);
  const outcome = await classify(request, {
    llm: deps.llm,
    cache: cache.cache,
    policy,
    timeoutMs: deps.classifierTimeoutMs,
    now,
  });
  const { classification } = outcome;

  // 5. Policy engine; 6. mediation only when every rule passed.
  const policyInput: EvaluatePolicyInput = {
    classification,
    user: request.user,
    policy,
    capState,
    surface: request.surface,
  };
  const policyResult = evaluatePolicy(policyInput);
  let mediation: MediationResult | null = null;
  let advertiserId: string | null = null;
  if (policyResult.allowed) {
    const built = await deps.adapters.build({ app, policy, log });
    mediation = await mediate(
      built.adapters,
      demandRequestOf(app, request, classification, outcome.keywords),
      policy,
      { timeoutMs: deps.demandTimeoutMs, now },
    );
    if (mediation.selected === null) {
      // no_fill. Say once per (app, reason) when the catalog DOES hold matching creatives that
      // can never serve for this app, which is otherwise visible only inside the demand trace.
      deps.catalogWarnings.warnNoFill({
        appId: app.id,
        catalog: built.catalog,
        classification,
        policy,
        affiliateConfig: built.affiliateConfig,
        log,
      });
    } else {
      advertiserId = built.advertiserIds.get(mediation.selected.id) ?? null;
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
  // The cap state read under that lock is authoritative: when it caps a turn the pre-lock
  // state allowed, the record is built from the fresh decisions with no demand (mediation ran
  // for nothing) and the response follows the record, so two concurrent turns never both serve.
  let capRecheck: 'suppressed' | undefined;
  const persisted = await deps.auditStore.persist({
    appId: app.id,
    build: (previous, freshCaps) => {
      const prev_hash = nextPrevHash(previous);
      if (!policyResult.allowed) {
        return buildAuditRecord({ ...base, prev_hash });
      }
      const fresh = evaluatePolicy({ ...policyInput, capState: freshCaps });
      if (fresh.allowed) {
        return buildAuditRecord({ ...base, prev_hash });
      }
      capRecheck = 'suppressed';
      return buildAuditRecord({ ...base, policyResult: fresh, mediation: null, prev_hash });
    },
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
    demand: persisted.record.demand,
    diagnostics: {
      classify_source: outcome.source,
      cache_source: cache.source,
      ...(outcome.llm_failure === undefined ? {} : { llm_failure: outcome.llm_failure }),
      ...(outcome.error_name === undefined ? {} : { error_name: outcome.error_name }),
      ...(capRecheck === undefined ? {} : { cap_recheck: capRecheck }),
      persisted: true,
      seq: persisted.seq,
    },
  };
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
