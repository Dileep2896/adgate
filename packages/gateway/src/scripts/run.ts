import { loadRootEnvFile } from '../env-file.js';
import { createDb, type DbHandle } from '../db/client.js';
import { UsageError } from './args.js';

/**
 * Shared plumbing of the database scripts: load the repo-root .env like server.ts, connect
 * to DATABASE_URL with a single connection, run, close, and turn errors into exit code 1
 * with a readable line. Nothing here is imported by the server.
 */

export const connectFromEnv = (): DbHandle => {
  loadRootEnvFile();
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new UsageError('DATABASE_URL is not set (see .env.example)');
  }
  return createDb(url, { max: 1 });
};

export interface ScriptSpec {
  usage: string;
  /** Returns the text to print on success. */
  main: (argv: readonly string[]) => Promise<string>;
}

/** Runs a script's main and maps its outcome to stdout/stderr and the exit code. */
export const runScript = async (spec: ScriptSpec, argv: readonly string[]): Promise<void> => {
  try {
    process.stdout.write(await spec.main(argv));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${spec.usage}`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
};
