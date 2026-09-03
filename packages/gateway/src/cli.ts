import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Helpers for the package's command line entry points (keygen, db:migrate). */

/** True when the module at `moduleUrl` is the script Node was started with (tsx or node). */
export const isMainModule = (
  moduleUrl: string,
  argv: readonly string[] = process.argv,
): boolean => {
  const entry = argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return pathToFileURL(resolve(entry)).href === moduleUrl;
  } catch {
    return false;
  }
};

/** A connection string safe to print: the password is replaced, everything else kept. */
export const redactDatabaseUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.password !== '') {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '<unparseable database url>';
  }
};
