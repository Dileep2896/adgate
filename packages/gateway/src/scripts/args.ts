/**
 * A deliberately small flag parser for the package's command line scripts: `--flag value`,
 * `--flag=value`, boolean `--flag`, and `--help`/`-h`. Unknown flags, repeated flags, missing
 * values and stray positional arguments are UsageErrors so a typo never silently runs with
 * defaults (these scripts write to the database).
 */

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export type FlagKind = 'string' | 'boolean';

export interface ParsedFlags {
  help: boolean;
  flags: Record<string, string | true>;
}

export const parseFlags = (
  argv: readonly string[],
  spec: Readonly<Record<string, FlagKind>>,
): ParsedFlags => {
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') {
      return { help: true, flags };
    }
    if (arg === '--') {
      // pnpm 9 forwards a literal `--` to the script; both `pnpm create-app --name x` and
      // `pnpm create-app -- --name x` must work, so the marker is ignored.
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new UsageError(`unexpected argument: ${arg}`);
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    const kind = spec[name];
    if (kind === undefined) {
      throw new UsageError(`unknown flag --${name}`);
    }
    if (name in flags) {
      throw new UsageError(`--${name} given twice`);
    }
    if (kind === 'boolean') {
      if (inline !== undefined) {
        throw new UsageError(`--${name} takes no value`);
      }
      flags[name] = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new UsageError(`--${name} requires a value`);
      }
      value = next;
      index += 1;
    }
    flags[name] = value;
  }
  return { help: false, flags };
};

/** A string flag that was given and is not blank, trimmed. */
export const requireFlag = (flags: ParsedFlags['flags'], name: string): string => {
  const value = optionalFlag(flags, name);
  if (value === null) {
    throw new UsageError(`--${name} is required`);
  }
  return value;
};

/** A string flag when given (blank counts as a usage error), else null. */
export const optionalFlag = (flags: ParsedFlags['flags'], name: string): string | null => {
  const value = flags[name];
  if (value === undefined) {
    return null;
  }
  if (value === true || value.trim() === '') {
    throw new UsageError(`--${name} must not be blank`);
  }
  return value.trim();
};
