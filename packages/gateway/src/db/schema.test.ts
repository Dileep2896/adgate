import { DemandSource, Decision, EventType } from '@adgate/schemas';
import { getTableName } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findMigrationsDir } from './migrate.js';
import {
  ALL_TABLES,
  AUDIT_DECISIONS,
  CREATIVE_SOURCES,
  EVENT_TYPES,
  TABLE_NAMES,
} from './schema.js';

describe('schema', () => {
  it('lists the ten tables of the story plus rate_limits (S21)', () => {
    expect(TABLE_NAMES).toEqual([
      'apps',
      'advertisers',
      'api_keys',
      'creatives',
      'audit_records',
      'events',
      'raw_text',
      'cap_state',
      'user_day_caps',
      'classify_cache',
      'rate_limits',
    ]);
    expect(ALL_TABLES.map((table) => getTableName(table))).toEqual(TABLE_NAMES);
  });

  it('keeps the CHECK constraint lists equal to the contract enums', () => {
    expect([...AUDIT_DECISIONS]).toEqual(Decision.options);
    expect([...EVENT_TYPES]).toEqual(EventType.options);
    expect([...CREATIVE_SOURCES]).toEqual(DemandSource.options);
  });

  it('never imports contract values into the table modules (drizzle-kit loads them as CJS)', () => {
    const dir = join(findMigrationsDir(), '..', 'src', 'db', 'tables');
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), 'utf8');
      const imports = source.match(/^import .* from '@adgate\/schemas';$/gm) ?? [];
      for (const line of imports) {
        expect(line, `${file}: ${line}`).toMatch(/^import type /);
      }
    }
  });

  it('has a committed migration whose SQL creates every table', () => {
    const dir = findMigrationsDir();
    const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.length).toBeGreaterThanOrEqual(1);
    const sql = journal.entries
      .map((entry) => readFileSync(join(dir, `${entry.tag}.sql`), 'utf8'))
      .join('\n');
    for (const name of TABLE_NAMES) {
      expect(sql).toContain(`CREATE TABLE "${name}"`);
    }
  });
});
