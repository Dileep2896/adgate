import {
  CATEGORIES_TAXONOMY,
  Classification,
  LlmOutput,
  SENSITIVE_TAXONOMY,
  type ContentCategory,
  type SensitiveCategory,
} from '@adgateio/schemas';

import { PROMPT_VERSION } from './prompt.js';
import type { LlmClassification } from './types.js';

/**
 * Turns the model's message content into a Classification. Three steps, each with its own
 * failure reason: JSON.parse (reason 'parse'), the LlmOutput schema after clamping the two
 * numbers into [0, 1] (reason 'invalid'), then taxonomy normalisation. Details never quote the
 * content: JSON.parse messages in Node 20 include a snippet of the input, so they are dropped,
 * and schema issues are reported as path and code only.
 */
export type LlmContentParse =
  | { ok: true; classification: LlmClassification }
  | { ok: false; reason: 'parse' | 'invalid'; detail: string };

const CATEGORY_SET: ReadonlySet<string> = new Set<string>(CATEGORIES_TAXONOMY);
const SENSITIVE_SET: ReadonlySet<string> = new Set<string>(SENSITIVE_TAXONOMY);

// ```json ... ``` or ``` ... ```: some models fence their output even in JSON mode.
const FENCED = /^\s*```[a-z]*\s*([\s\S]*?)\s*```\s*$/i;

const stripFence = (content: string): string => FENCED.exec(content)?.[1] ?? content;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Clamps every finite top-level number so 1.02 or -0.1 become valid instead of 'invalid'. */
const clampNumbers = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const clamped: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    clamped[key] = typeof field === 'number' && Number.isFinite(field) ? clamp01(field) : field;
  }
  return clamped;
};

/** "Self-Harm", " self harm " and "SELF_HARM" all become "self_harm". */
const toTaxonomyToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const normalizeList = <T extends string>(
  values: readonly string[],
  allowed: ReadonlySet<string>,
): T[] => {
  const out: T[] = [];
  for (const raw of values) {
    const token = toTaxonomyToken(raw);
    if (allowed.has(token) && !out.includes(token as T)) {
      out.push(token as T);
    }
  }
  return out;
};

export const normalizeCategories = (values: readonly string[]): ContentCategory[] => {
  const categories = normalizeList<ContentCategory>(values, CATEGORY_SET);
  return categories.length > 0 ? categories : ['general'];
};

export const normalizeSensitive = (values: readonly string[]): SensitiveCategory[] =>
  normalizeList<SensitiveCategory>(values, SENSITIVE_SET);

export const toLlmClassification = (output: LlmOutput): LlmClassification => ({
  commercial_intent: output.commercial_intent,
  categories: normalizeCategories(output.categories),
  sensitive: normalizeSensitive(output.sensitive),
  confidence: output.confidence,
  method: 'llm',
  prompt_version: PROMPT_VERSION,
});

const issueSummary = (issues: readonly { path: PropertyKey[]; code: string }[]): string =>
  issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || '$'}: ${issue.code}`)
    .join('; ');

export const parseLlmContent = (content: string): LlmContentParse => {
  let json: unknown;
  try {
    json = JSON.parse(stripFence(content));
  } catch {
    return { ok: false, reason: 'parse', detail: 'model content is not valid JSON' };
  }
  const output = LlmOutput.safeParse(clampNumbers(json));
  if (!output.success) {
    return { ok: false, reason: 'invalid', detail: issueSummary(output.error.issues) };
  }
  const classification = toLlmClassification(output.data);
  const check = Classification.safeParse(classification);
  if (!check.success) {
    return { ok: false, reason: 'invalid', detail: issueSummary(check.error.issues) };
  }
  return { ok: true, classification };
};
