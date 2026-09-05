import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { rawText, TABLE_NAMES } from '../db/schema.js';
import {
  columnsContaining,
  tableNamesInDatabase,
  textualColumns,
} from '../test-support/table-scan.js';
import {
  createHarness,
  evaluateBody,
  type Harness,
  tablesContaining,
  TEXT,
} from './test-support.js';

/**
 * Raw message text never reaches a table unless policy.privacy.store_raw_text is true, and
 * even then only raw_text (never the signed record). The claim in docs/privacy.md.
 *
 * The search is exhaustive BY CONSTRUCTION, not by inspection: columnsContaining reads
 * information_schema and probes every text, varchar, json and jsonb column of every table in
 * the database, so a column or a table a later story adds is covered the day it is added
 * rather than the day somebody remembers this file. `tablesContaining` (row_to_json over the
 * ORM's table list) is kept alongside it as a second, independent pass.
 */
let h: Harness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

const RAW_TEXT_POLICY = [
  'version: 1',
  'app_id: raw-text-app',
  'privacy:',
  '  store_raw_text: true',
  '',
].join('\n');

/**
 * Everything a turn is made of that must never be persisted in the clear: the message text,
 * words out of it, and the two identifiers docs/audit.md stores as salted hashes. `turn_id` is
 * deliberately NOT on this list - the contract puts it in the record verbatim, so it is the
 * app's job to keep it opaque.
 */
const SECRETS = [
  TEXT.serve,
  TEXT.health,
  TEXT.lowIntent,
  'ibuprofen',
  'conv_1',
  'conv_2',
  'user-12345',
];

describe('raw message text', () => {
  it('is absent from every table under the default policy, after a serve and a suppress', async () => {
    h = await createHarness();
    const served = await h.evaluate(evaluateBody(h.appId));
    expect(served.decision).toBe('serve');
    const suppressed = await h.evaluate(
      evaluateBody(h.appId, { conversation_id: 'conv_2', content: TEXT.health }),
    );
    expect(suppressed.reason).toBe('sensitive_category:health');
    expect(await tablesContaining(h.handle, TEXT.serve)).toEqual([]);
    expect(await tablesContaining(h.handle, TEXT.health)).toEqual([]);
    expect(await tablesContaining(h.handle, 'ibuprofen')).toEqual([]);
    expect(await tablesContaining(h.handle, 'conv_1')).toEqual([]);
    expect(await tablesContaining(h.handle, h.appId)).not.toEqual([]);
  });

  it('is absent from EVERY text and jsonb column of EVERY table, over every decision path', async () => {
    h = await createHarness();
    // One of each shape a turn can take, so no code path escapes the scan.
    expect((await h.evaluate(evaluateBody(h.appId, { user: user('conv_1') }))).decision).toBe(
      'serve',
    );
    expect(
      (
        await h.evaluate(
          evaluateBody(h.appId, {
            conversation_id: 'conv_2',
            content: TEXT.health,
            user: user('conv_2'),
          }),
        )
      ).decision,
    ).toBe('suppress');
    expect(
      (
        await h.evaluate(
          evaluateBody(h.appId, { conversation_id: 'conv_3', content: TEXT.lowIntent }),
        )
      ).decision,
    ).toBe('suppress');

    for (const secret of SECRETS) {
      expect(await columnsContaining(h.handle, secret), `leaked: ${secret}`).toEqual([]);
    }
    // The scan is only worth something if it really looked: the signed record and the policy
    // document are both in it, and finding the app id proves a positive is reportable.
    const scanned = (await textualColumns(h.handle)).map((c) => `${c.table}.${c.column}`);
    expect(scanned).toContain('audit_records.record');
    expect(scanned).toContain('apps.policy_yaml');
    expect(scanned).toContain('raw_text.text');
    expect(scanned).toContain('events.meta');
    expect(scanned).toContain('classify_cache.classification');
    expect(await columnsContaining(h.handle, h.appId)).not.toEqual([]);
  });

  it('scans every table the database has, not only the ones the ORM declares', async () => {
    h = await createHarness();
    expect(await tableNamesInDatabase(h.handle)).toEqual([...TABLE_NAMES].sort());
  });

  it('is kept in raw_text only, keyed by audit_id, when the policy allows it', async () => {
    h = await createHarness({ policyYaml: RAW_TEXT_POLICY });
    const res = await h.evaluate(evaluateBody(h.appId));
    expect(res.decision).toBe('serve');
    const rows = await h.handle.db.select().from(rawText).where(eq(rawText.auditId, res.audit_id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appId).toBe(h.appId);
    expect(rows[0]?.text).toBe(`user: ${TEXT.serve}`);
    expect(await tablesContaining(h.handle, TEXT.serve)).toEqual(['raw_text']);
    expect(await columnsContaining(h.handle, TEXT.serve)).toEqual(['raw_text.text']);
    const stored = await h.handle.sql<{ record: string }[]>`
      select record::text as record from audit_records where id = ${res.audit_id}
    `;
    expect(stored[0]?.record).not.toContain(TEXT.serve);
    expect(stored[0]?.record).not.toContain('postgres hosting');
  });

  it('cannot be enabled by a request override', async () => {
    h = await createHarness();
    const res = await h.evaluate(
      evaluateBody(h.appId, { policy_overrides: { privacy: { store_raw_text: true } } }),
    );
    expect(res.decision).toBe('serve');
    expect(await h.handle.db.select().from(rawText)).toEqual([]);
    expect(await tablesContaining(h.handle, TEXT.serve)).toEqual([]);
    expect(await columnsContaining(h.handle, TEXT.serve)).toEqual([]);
  });
});

/** A user with a raw id: it must be salted and hashed before it reaches any column. */
const user = (suffix: string) => ({
  tier: 'free' as const,
  region: 'US',
  locale: 'en-US',
  user_id: `user-12345-${suffix}`,
});
