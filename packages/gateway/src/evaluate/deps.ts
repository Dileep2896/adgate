import {
  type AuditSigningKey,
  type Clock,
  createLruCache,
  DEFAULT_DEMAND_TIMEOUT_MS,
  type LlmClassifier,
  type LruCache,
  OpenAiCompatibleClassifier,
  type PublicKeyRing,
} from '@adgate/core';

import type { GatewayConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { type GatewaySigningKeys, loadSigningKeys } from '../signing.js';
import { type AdapterFactory, createAdapterFactory } from './adapters.js';
import { type AuditStore, createAuditStore } from './audit-store.js';
import { type CapReader, createCapReader } from './caps.js';
import {
  createLayeredClassifyCache,
  createPgClassifyCache,
  type LayeredClassifyCache,
} from './classify-cache-pg.js';
import { createDeliverabilityWarner, type DeliverabilityWarner } from './deliverability-warning.js';
import { createPolicyLoader, type PolicyLoader } from './policy-loader.js';

/**
 * Everything the evaluate route needs, assembled once per process by createEvaluateDeps from
 * the gateway config and the database, and shared by the other /v1 routes (attest, events,
 * click, audit read and verify). Every collaborator is an interface so tests can inject a
 * FakeLlmClassifier, a fixed clock, a scripted adapter factory or an audit store that fails.
 */
export interface EvaluateDeps {
  db: Db;
  /** PUBLIC_BASE_URL: creative.url is `${publicBaseUrl}/c/${audit_id}`. */
  publicBaseUrl: string;
  signing: AuditSigningKey;
  /** The public keys GET /v1/verify checks signatures against (the signing key's included). */
  ring: PublicKeyRing;
  /** null = no LLM configured: the classifier runs rules only. */
  llm: LlmClassifier | null;
  /** The orchestrator's deadline on the LLM stage (CLASSIFIER_TIMEOUT_MS). */
  classifierTimeoutMs: number;
  /** Per-adapter mediation budget (docs/api.md: 250 ms each, in parallel). */
  demandTimeoutMs: number;
  /** Milliseconds clock for timestamps, ids, cache expiry and latency_ms. */
  now: Clock;
  policies: PolicyLoader;
  classifyCache: LayeredClassifyCache;
  caps: CapReader;
  adapters: AdapterFactory;
  auditStore: AuditStore;
  /** One warn line per (app, reason) when no_fill was caused by an unservable catalog. */
  catalogWarnings: DeliverabilityWarner;
}

/** Overrides for createEvaluateDeps. `llm: null` forces rules only; undefined = from config. */
export interface EvaluateDepsOverrides {
  signing?: AuditSigningKey | undefined;
  ring?: PublicKeyRing | undefined;
  llm?: LlmClassifier | null | undefined;
  now?: Clock | undefined;
  /** The process-wide in-memory tier of the classifier cache. */
  lru?: LruCache | undefined;
  classifyCache?: LayeredClassifyCache | undefined;
  policies?: PolicyLoader | undefined;
  caps?: CapReader | undefined;
  adapters?: AdapterFactory | undefined;
  auditStore?: AuditStore | undefined;
  catalogWarnings?: DeliverabilityWarner | undefined;
  classifierTimeoutMs?: number | undefined;
  demandTimeoutMs?: number | undefined;
}

/** The OpenAI compatible classifier over the platform fetch, or null when not configured. */
export const llmFromConfig = (config: GatewayConfig): LlmClassifier | null =>
  config.classifier === null
    ? null
    : new OpenAiCompatibleClassifier({
        ...config.classifier,
        fetch: (url, init) => globalThis.fetch(url, init),
      });

export const createEvaluateDeps = (
  config: GatewayConfig,
  db: Db,
  overrides: EvaluateDepsOverrides = {},
): EvaluateDeps => {
  const now = overrides.now ?? Date.now;
  const lru = overrides.lru ?? createLruCache({ now });
  let keys: GatewaySigningKeys | null = null;
  /** The configured keys, loaded once and only when an override does not supply them. */
  const configuredKeys = (): GatewaySigningKeys => (keys ??= loadSigningKeys(config.signing));
  return {
    db,
    publicBaseUrl: config.publicBaseUrl,
    signing: overrides.signing ?? configuredKeys().signing,
    ring: overrides.ring ?? configuredKeys().ring,
    llm: overrides.llm === undefined ? llmFromConfig(config) : overrides.llm,
    classifierTimeoutMs: overrides.classifierTimeoutMs ?? config.classifierTimeoutMs,
    demandTimeoutMs: overrides.demandTimeoutMs ?? DEFAULT_DEMAND_TIMEOUT_MS,
    now,
    policies: overrides.policies ?? createPolicyLoader(),
    classifyCache:
      overrides.classifyCache ??
      createLayeredClassifyCache(lru, createPgClassifyCache(db, { now }), { now }),
    caps: overrides.caps ?? createCapReader(db),
    adapters:
      overrides.adapters ??
      createAdapterFactory(db, { koah: config.koah, gravity: config.gravity, now }),
    auditStore: overrides.auditStore ?? createAuditStore(db),
    catalogWarnings: overrides.catalogWarnings ?? createDeliverabilityWarner(),
  };
};
