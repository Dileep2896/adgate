import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locating files relative to the repo and the package without depending on the process cwd
 * (turbo runs package scripts inside packages/gateway, vitest and tsx may run from the root)
 * or on whether the code runs from src/ or from the bundled dist/.
 */

export const REPO_ROOT_MARKER = 'pnpm-workspace.yaml';

/** The closest ancestor of `start` (inclusive) that contains `marker`, or null within maxDepth. */
export const findUpwards = (start: string, marker: string, maxDepth = 8): string | null => {
  let current = resolve(start);
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (existsSync(join(current, marker))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
};

const moduleDir = (): string => dirname(fileURLToPath(import.meta.url));

/** The monorepo root (the directory holding pnpm-workspace.yaml), or null outside the repo. */
export const findRepoRoot = (start: string = moduleDir()): string | null =>
  findUpwards(start, REPO_ROOT_MARKER);

/**
 * Loads `<repo root>/.env` into process.env with Node's built-in parser when the file exists.
 * Variables already present in the environment keep their value (CI sets them directly and
 * has no .env). Returns the path that was loaded, or null when there was nothing to load.
 * No dotenv dependency: process.loadEnvFile ships with Node 20.12+.
 */
export const loadRootEnvFile = (start?: string): string | null => {
  const root = findRepoRoot(start);
  if (root === null) {
    return null;
  }
  const file = join(root, '.env');
  if (!existsSync(file)) {
    return null;
  }
  process.loadEnvFile(file);
  return file;
};
