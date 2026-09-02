import { parse as parseYamlDocument, YAMLParseError } from 'yaml';

import { PolicyConfig } from './policy.js';

/** One human-readable validation problem. path is dotted, with [n] for array indexes; '' is the root. */
export interface PolicyIssue {
  path: string;
  message: string;
}

/**
 * Thrown by parsePolicy and parsePolicyYaml. Policies are loaded by config-time code (app
 * registration, the dashboard, a CLI), where a thrown, well-formatted error is the useful shape.
 * Never let it reach an /v1/evaluate caller: the gateway wraps everything and suppresses.
 */
export class PolicyValidationError extends Error {
  override readonly name = 'PolicyValidationError';
  readonly issues: readonly PolicyIssue[];

  constructor(issues: readonly PolicyIssue[]) {
    super(formatIssues(issues));
    this.issues = issues;
  }
}

const formatIssues = (issues: readonly PolicyIssue[]): string =>
  [
    'Invalid policy:',
    ...issues.map((issue) => `  - ${issue.path || '(root)'}: ${issue.message}`),
  ].join('\n');

const formatPath = (path: readonly PropertyKey[]): string =>
  path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`;
    }
    return acc === '' ? String(segment) : `${acc}.${String(segment)}`;
  }, '');

/** Validates a parsed document (JSON, or anything already an object) and applies the defaults. */
export const parsePolicy = (input: unknown): PolicyConfig => {
  const result = PolicyConfig.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new PolicyValidationError(
    result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
  );
};

/**
 * Parses one YAML document (YAML 1.2 core schema: `yes` stays a string, duplicate keys are an
 * error) and validates it as a PolicyConfig. Use loadPolicyFromYaml in @adgate/core when the
 * policy_hash is needed as well.
 */
export const parsePolicyYaml = (yamlText: string): PolicyConfig => {
  let document: unknown;
  try {
    document = parseYamlDocument(yamlText) as unknown;
  } catch (error) {
    if (error instanceof YAMLParseError) {
      throw new PolicyValidationError([{ path: '', message: `YAML syntax: ${error.message}` }]);
    }
    throw error;
  }
  return parsePolicy(document);
};
