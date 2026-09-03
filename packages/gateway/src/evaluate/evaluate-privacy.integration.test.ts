import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { rawText } from '../db/schema.js';
import {
  createHarness,
  evaluateBody,
  type Harness,
  tablesContaining,
  TEXT,
} from './test-support.js';

/**
 * Raw message text never reaches a table unless policy.privacy.store_raw_text is true, and
 * even then only raw_text (never the signed record). The query scans every table's rows as JSON.
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

  it('is kept in raw_text only, keyed by audit_id, when the policy allows it', async () => {
    h = await createHarness({ policyYaml: RAW_TEXT_POLICY });
    const res = await h.evaluate(evaluateBody(h.appId));
    expect(res.decision).toBe('serve');
    const rows = await h.handle.db.select().from(rawText).where(eq(rawText.auditId, res.audit_id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appId).toBe(h.appId);
    expect(rows[0]?.text).toBe(`user: ${TEXT.serve}`);
    expect(await tablesContaining(h.handle, TEXT.serve)).toEqual(['raw_text']);
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
  });
});
