import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apiKeys } from '@adgate/gateway/schema';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * "THE KEY IS SHOWN EXACTLY ONCE AND IS NEVER RETRIEVABLE AGAIN" (S31), asserted in the default
 * gate.
 *
 * It was only ever checked by the Playwright spec, which `pnpm test` does not run, so the one
 * criterion that matters most about API keys could have been broken by any change to a query or
 * a page without a red test. A key value exists in exactly one place - the return value of the
 * action that mints it (app/(dashboard)/apps/actions.ts), which React holds in memory and
 * nothing persists - so this pins the two facts that keep it that way: the read side never
 * SELECTs the stored secret, and no page or component knows the name of a column that holds one.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The columns of api_keys that are, or are half of, a secret. Never selected, never rendered. */
const SECRET_COLUMNS = ['hashedKey', 'keyPrefix', 'hashed_key', 'key_prefix'] as const;

const RENDERED_DIRS = ['app', 'components'] as const;
const SOURCE_SUFFIXES = ['.ts', '.tsx'] as const;

const sourceFiles = (dir: string): string[] => {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...sourceFiles(full));
    } else if (SOURCE_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
      entries.push(full);
    }
  }
  return entries;
};

describe('the API key read path', () => {
  it('still describes the columns this test is guarding', () => {
    // If the schema renames them, the greps below would silently pass for the wrong reason.
    const columns = Object.keys(getTableColumns(apiKeys));
    expect(columns).toContain('hashedKey');
    expect(columns).toContain('keyPrefix');
  });

  it('never selects the stored secret or its prefix', () => {
    const queries = readFileSync(join(packageRoot, 'lib', 'queries.ts'), 'utf8');
    expect(queries).toContain('listApiKeys');
    // The column names appear in that file's prose (saying they are NOT selected), so this
    // looks for the only thing that would actually read one: the Drizzle column reference.
    for (const column of ['apiKeys.hashedKey', 'apiKeys.keyPrefix']) {
      expect(queries, column).not.toContain(column);
    }
  });

  it('is the only module that reads api_keys at all', () => {
    const readers = sourceFiles(join(packageRoot, 'lib'))
      .filter((file) => !file.endsWith('.test.ts'))
      .filter((file) => /\bapiKeys\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(packageRoot, file).split('\\').join('/'));
    expect(readers).toEqual(['lib/queries.ts']);
  });

  it('is never rendered by a page or a component', () => {
    const offenders = [...RENDERED_DIRS]
      .flatMap((dir) => sourceFiles(join(packageRoot, dir)))
      .filter((file) =>
        SECRET_COLUMNS.some((column) => readFileSync(file, 'utf8').includes(column)),
      )
      .map((file) => relative(packageRoot, file).split('\\').join('/'));
    expect(offenders).toEqual([]);
  });

  it('keeps the once-only key out of everything but the action that mints it', () => {
    // `apiKey` is the field CreatedApp carries back to the form. It may appear in the action
    // that returns it, the state type that declares it and the form that renders it once.
    //
    // lib/integration-snippets.ts is the fourth name here and is a different case: it spells
    // `apiKey` only inside the SDK snippet TEXT it hands the operator, where the value is
    // always the name of an environment variable. It is allowed in this list and then held to
    // a stricter rule than the other three by the test below.
    const holders = [...RENDERED_DIRS, 'lib']
      .flatMap((dir) => sourceFiles(join(packageRoot, dir)))
      .filter((file) => !file.endsWith('.test.ts'))
      .filter((file) => /\bapiKey\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(packageRoot, file).split('\\').join('/'))
      .sort();
    expect(holders).toEqual([
      'app/(dashboard)/apps/actions.ts',
      'components/new-app-form.tsx',
      'lib/action-state.ts',
      'lib/integration-snippets.ts',
    ]);
  });

  /**
   * The integration snippets are shown on the app's own page, which an operator reloads long
   * after the key is gone. So the module that builds them may never carry a key value at all:
   * its single `apiKey` reads an environment variable, and nothing in it is key shaped.
   */
  it('never puts a key value in the snippets it hands the operator', () => {
    const snippets = readFileSync(join(packageRoot, 'lib', 'integration-snippets.ts'), 'utf8');
    expect(snippets.match(/\bapiKey\b/g)).toHaveLength(1);
    expect(snippets).toContain('apiKey: process.env.${API_KEY_ENV}');
    // ak_<prefix>_<secret> is the shape of a real key (docs/api.md).
    expect(snippets).not.toMatch(/\bak_[A-Za-z0-9]{4,}_/);
  });
});
