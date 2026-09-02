import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { Classification, ClassificationMethod } from './classification.js';
import {
  AppId,
  AuditId,
  CreativeId,
  ErrorResponse,
  HealthResponse,
  IsoTimestamp,
  Message,
  MessageRole,
  Sha256Hash,
  Surface,
  SurfaceType,
  User,
} from './common.js';
import { Creative, DemandSource } from './creative.js';
import { Decision, EvaluateRequest, EvaluateResponse } from './evaluate.js';
import { AttestRequest, EventRequest, EventType } from './events.js';
import { PolicyConfig } from './policy.js';
import { CapState, PolicyDecision, PolicyRule } from './policy-decision.js';
import { PolicyOverrides } from './policy-overrides.js';
import { SuppressReason } from './suppress-reason.js';
import { ContentCategory, SensitiveCategory } from './taxonomy.js';
import { VerifyCheck, VerifyCheckName, VerifyResponse } from './verify.js';

/** Every contract schema that gets its own JSON Schema file, keyed by file basename. */
export const CONTRACT_SCHEMAS = {
  EvaluateRequest,
  EvaluateResponse,
  PolicyConfig,
  PolicyOverrides,
  PolicyDecision,
  PolicyRule,
  CapState,
  Classification,
  Creative,
  SuppressReason,
  AttestRequest,
  EventRequest,
  VerifyResponse,
  VerifyCheck,
  VerifyCheckName,
  Message,
  MessageRole,
  User,
  Surface,
  SurfaceType,
  Decision,
  DemandSource,
  ClassificationMethod,
  EventType,
  SensitiveCategory,
  ContentCategory,
  AppId,
  AuditId,
  CreativeId,
  Sha256Hash,
  IsoTimestamp,
  ErrorResponse,
  HealthResponse,
} as const;
export type ContractSchemaName = keyof typeof CONTRACT_SCHEMAS;

/** Default output directory: packages/schemas/json (one level above src/ and dist/). */
export const JSON_SCHEMA_DIR = fileURLToPath(new URL('../json/', import.meta.url));

export const jsonSchemaFileName = (name: ContractSchemaName): string => `${name}.schema.json`;

/**
 * Canonical form: object keys sorted at every level so output is stable across zod versions.
 * The `properties` map keeps declaration order so files read in contract order; that order is
 * itself deterministic (it follows the z.object shape).
 */
const canonicalize = (value: unknown, preserveKeyOrder = false): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  const keys = preserveKeyOrder ? Object.keys(record) : Object.keys(record).sort();
  return Object.fromEntries(
    keys.map((key) => [key, canonicalize(record[key], key === 'properties')]),
  );
};

/** JSON Schema (draft 2020-12) for one contract schema, as a plain object. */
export const toJsonSchemaObject = (name: ContractSchemaName): Record<string, unknown> => {
  // io: 'input' describes what the gateway accepts on the wire: unknown keys are stripped, not
  // rejected, so the files must not carry additionalProperties: false.
  const raw = z.toJSONSchema(CONTRACT_SCHEMAS[name], {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'throw',
  });
  return canonicalize(raw) as Record<string, unknown>;
};

/** File contents for one contract schema: canonical JSON, two-space indent, trailing newline. */
export const renderJsonSchema = (name: ContractSchemaName): string =>
  `${JSON.stringify(toJsonSchemaObject(name), null, 2)}\n`;

/** File contents for every contract schema, keyed by name. */
export const renderJsonSchemas = (): Record<ContractSchemaName, string> => {
  const names = Object.keys(CONTRACT_SCHEMAS) as ContractSchemaName[];
  return Object.fromEntries(names.map((name) => [name, renderJsonSchema(name)])) as Record<
    ContractSchemaName,
    string
  >;
};

/**
 * Writes `<outDir>/<Name>.schema.json` for every contract schema and returns the paths written.
 * json-schema.test.ts asserts the committed files match renderJsonSchemas() byte for byte.
 */
export const toJsonSchema = (outDir: string = JSON_SCHEMA_DIR): string[] => {
  mkdirSync(outDir, { recursive: true });
  return Object.entries(renderJsonSchemas()).map(([name, content]) => {
    const path = join(outDir, jsonSchemaFileName(name as ContractSchemaName));
    writeFileSync(path, content, 'utf8');
    return path;
  });
};
