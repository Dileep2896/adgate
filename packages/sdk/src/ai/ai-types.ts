import type { LanguageModelMiddleware } from 'ai';

import type { EvaluateResult } from '../types.js';

/**
 * The AI SDK interface surface: every shape the entry needs, DERIVED from
 * `LanguageModelMiddleware` rather than re-declared, so a major bump of the `ai` package changes
 * this one import and nothing else. The package is a types-only, optional peer dependency, so
 * nothing here survives into the bundle. The provider-metadata namespace lives here too, because
 * both the generate path and the stream transform write into it.
 */
type WrapGenerate = NonNullable<LanguageModelMiddleware['wrapGenerate']>;
type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>;

export type GenerateResult = Awaited<ReturnType<WrapGenerate>>;
export type StreamResult = Awaited<ReturnType<WrapStream>>;
export type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;
export type ProviderMetadata = NonNullable<GenerateResult['providerMetadata']>;
export type ProviderMetadataValue = ProviderMetadata[string];

/** The call options the AI SDK hands the middleware: prompt, abortSignal, settings, tools. */
export type AdgateCallParams = Parameters<WrapGenerate>[0]['params'];

/** What is attached to the result under `providerMetadata.adgate`. */
export type AdgateProviderMetadata = {
  decision: EvaluateResult;
  /** The audit record this turn was written to, or null when evaluate never reached the gateway. */
  audit_id: string | null;
};

export const ADGATE_METADATA_KEY = 'adgate';

/** The decision, shaped for provider metadata. It is JSON: it came from the gateway as JSON. */
export const metadataOf = (decision: EvaluateResult): ProviderMetadataValue => {
  const metadata: AdgateProviderMetadata = { decision, audit_id: decision.audit_id };
  return metadata as unknown as ProviderMetadataValue;
};
