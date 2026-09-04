import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The read-only guarantee, enforced rather than documented.
 *
 * lib/db.ts opens its pool with default_transaction_read_only so no page can modify the
 * gateway's signed audit chain. That is only worth having while it stays the default, so the
 * read-write handle (lib/db-write.ts) may be reached from exactly one module: the admin server
 * actions. This test fails the moment a second file imports it - which is the moment to ask
 * whether that file should be a server action instead.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SEARCHED_DIRS = ['app', 'components', 'lib', 'e2e'] as const;
const SOURCE_SUFFIXES = ['.ts', '.tsx'] as const;

/** The only module allowed to import the read-write handle. */
const ALLOWED = new Set(['app/(dashboard)/apps/actions.ts']);

/**
 * An import of the module, by either the alias or the relative path - not a mention of the
 * file name in prose. (This test's own source is skipped below; the pattern would match the
 * pattern.)
 */
const IMPORTS_DB_WRITE = /from\s+'(?:@\/lib|\.)\/db-write'/;

const SELF = 'lib/db-write-usage.test.ts';

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

const allSourceFiles = (): string[] =>
  SEARCHED_DIRS.flatMap((dir) => sourceFiles(join(packageRoot, dir)));

describe('the read-write database handle', () => {
  it('is imported by the admin server actions and nowhere else', () => {
    const importers = allSourceFiles()
      .filter((file) => IMPORTS_DB_WRITE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(packageRoot, file).split('\\').join('/'))
      .filter((file) => file !== SELF)
      .sort();

    expect(new Set(importers)).toEqual(ALLOWED);
  });

  it('finds the files it is supposed to be searching', () => {
    const files = allSourceFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((file) => file.endsWith('lib/db.ts'))).toBe(true);
  });

  it('keeps the read-only flag on the default handle', () => {
    const db = readFileSync(join(packageRoot, 'lib', 'db.ts'), 'utf8');
    expect(db).toContain('default_transaction_read_only: true');
  });

  it('does not set the read-only flag on the write handle', () => {
    const dbWrite = readFileSync(join(packageRoot, 'lib', 'db-write.ts'), 'utf8');
    expect(dbWrite).not.toContain('default_transaction_read_only:');
  });
});
