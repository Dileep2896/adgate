import pino, { type DestinationStream, type LevelWithSilent, type Logger } from 'pino';

/**
 * Structured logging (CLAUDE.md: pino, never log message content). Every log line passes
 * through redactSensitive, which replaces the value of any key named `messages`,
 * `context_summary`, `authorization` (and a few obvious secrets) at ANY depth, so no call site
 * can leak conversation text or a bearer token by accident. Request bodies are never logged
 * at all (request-id.ts logs method, path, status and timing only).
 */

export type LogLevel = LevelWithSilent;
export type { Logger };

export const REDACTED = '[Redacted]';

/** Compared case-insensitively against every object key. */
export const REDACT_KEYS: ReadonlySet<string> = new Set([
  'messages',
  'context_summary',
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apikey',
  'password',
  'private_pem',
  'privatepem',
  'hashed_key',
]);

const MAX_DEPTH = 12;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Error) &&
  !(value instanceof Date);

const walk = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    return depth >= MAX_DEPTH ? '[Truncated]' : value.map((entry) => walk(entry, depth + 1, seen));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = REDACT_KEYS.has(key.toLowerCase()) ? REDACTED : walk(entry, depth + 1, seen);
  }
  return out;
};

/** A copy of `value` with every sensitive key replaced by REDACTED, at any depth. */
export const redactSensitive = (value: Record<string, unknown>): Record<string, unknown> =>
  walk(value, 0, new WeakSet()) as Record<string, unknown>;

export interface LoggerOptions {
  level: LogLevel;
}

/**
 * The root logger. `destination` defaults to stdout; tests pass an in-memory stream. Child
 * loggers (per request, see request-id.ts) inherit the redaction.
 */
export const createLogger = (options: LoggerOptions, destination?: DestinationStream): Logger => {
  const pinoOptions = {
    level: options.level,
    base: { service: 'adgate-gateway' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { log: redactSensitive },
    serializers: { err: pino.stdSerializers.err },
  };
  return destination === undefined ? pino(pinoOptions) : pino(pinoOptions, destination);
};
