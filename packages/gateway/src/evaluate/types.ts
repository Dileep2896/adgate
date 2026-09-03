import type { ClassifyLlmFailure, ClassifySource } from '@adgate/core';
import type { EvaluateRequest, EvaluateResponse } from '@adgate/schemas';
import type { Logger } from 'pino';

import type { AppRow } from '../db/tables/apps.js';
import type { CacheSource } from './classify-cache-pg.js';

/** The shapes evaluate() (pipeline.ts) and its fail-closed path (fail-closed.ts) share. */
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
  /**
   * 'suppressed' when the policy allowed the turn on the cap state read before classifying,
   * but the state re-read under the app lock (a concurrent turn had served) capped it.
   */
  cap_recheck?: 'suppressed';
  /** false only when the error path could not write its record either. */
  persisted: boolean;
  seq?: number;
}

export interface EvaluateResult {
  response: EvaluateResponse;
  diagnostics: EvaluateDiagnostics;
}
