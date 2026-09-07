import type { CreativeRow, CreativeWriteResult } from '@adgate/gateway/admin';
import { describe, expect, it } from 'vitest';

import type { CreativeFormContext, CreativeFormValue } from './creative-form';
import { NEW_ADVERTISER_VALUE } from './creative-issue';
import { type CreativeWriter, issueForFailure, saveCreative } from './creative-save';

/**
 * The order of operations, proved with a writer that records whether it was touched at all: a
 * form with a bad field must not reach Postgres, because a half-written creative is a creative
 * the demand adapters might load.
 */

const CONTEXT: CreativeFormContext = {
  advertisers: [{ id: 'adv_1', name: 'Example DB Cloud', domain: 'exampledb.dev' }],
  appIds: ['app_1'],
  allowGlobalCatalog: true,
};

const VALID: Record<string, string> = {
  advertiser_id: 'adv_1',
  headline: 'Managed Postgres',
  body: '',
  cta: 'Try it',
  url_template: 'https://exampledb.dev/',
  target_categories: 'software.devtools.database',
  target_regions: 'US',
  keywords: 'postgres',
  ecpm: '12',
  source: 'direct',
  active: 'on',
  app_id: '',
};

const formOf = (fields: Record<string, string>) => ({
  get: (name: string): unknown => fields[name] ?? null,
});

const row = (id: string): CreativeRow => ({
  id,
  advertiserId: 'adv_1',
  appId: null,
  headline: 'Managed Postgres',
  body: '',
  cta: 'Try it',
  urlTemplate: 'https://exampledb.dev/',
  targetCategories: ['software.devtools.database'],
  targetRegions: ['US'],
  keywords: ['postgres'],
  ecpm: 12,
  source: 'direct',
  network: null,
  programId: null,
  active: true,
  contentHash: `sha256:${'a'.repeat(64)}`,
  createdAt: new Date('2026-09-04T00:00:00.000Z'),
  updatedAt: new Date('2026-09-04T00:00:00.000Z'),
});

interface Recorder extends CreativeWriter {
  calls: { op: 'create' | 'update'; id: string | null; value: CreativeFormValue }[];
}

const recordingWriter = (result: CreativeWriteResult = { ok: true, creative: row('cr_1') }) => {
  const writer: Recorder = {
    calls: [],
    create: (value) => {
      writer.calls.push({ op: 'create', id: null, value });
      return Promise.resolve(result);
    },
    update: (id, value) => {
      writer.calls.push({ op: 'update', id, value });
      return Promise.resolve(result);
    },
  };
  return writer;
};

describe('saveCreative', () => {
  it('writes nothing at all when a field is invalid', async () => {
    const writer = recordingWriter();
    const result = await saveCreative(
      writer,
      formOf({ ...VALID, ecpm: '-3', target_categories: 'not.a.category' }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    expect(writer.calls).toEqual([]);
    expect(result.ok ? [] : result.issues.map((issue) => issue.field)).toEqual([
      'target_categories',
      'ecpm',
    ]);
  });

  it('creates when the form carries no id', async () => {
    const writer = recordingWriter();
    const result = await saveCreative(writer, formOf(VALID), CONTEXT);
    expect(result).toEqual({
      ok: true,
      id: 'cr_1',
      contentHash: `sha256:${'a'.repeat(64)}`,
      created: true,
    });
    expect(writer.calls[0]?.op).toBe('create');
    expect(writer.calls[0]?.value.seed.advertiser).toBe('Example DB Cloud');
  });

  it('updates when it carries one', async () => {
    const writer = recordingWriter({ ok: true, creative: row('cr_9') });
    const result = await saveCreative(writer, formOf({ ...VALID, id: 'cr_9' }), CONTEXT);
    expect(result).toMatchObject({ ok: true, id: 'cr_9', created: false });
    expect(writer.calls[0]).toMatchObject({ op: 'update', id: 'cr_9' });
  });

  it('puts a write the gateway refused on the field that caused it', async () => {
    const writer = recordingWriter({
      ok: false,
      error: 'duplicate_headline',
      headline: 'Managed Postgres',
      creativeId: 'cr_other',
    });
    const result = await saveCreative(writer, formOf(VALID), CONTEXT);
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.issues[0]?.field).toBe('headline');
    expect(result.ok ? '' : result.issues[0]?.message).toContain('cr_other');
  });
});

describe('issueForFailure', () => {
  it('maps every refusal onto a field', () => {
    expect(
      issueForFailure({
        ok: false,
        error: 'advertiser_name_conflict',
        domain: 'exampledb.dev',
        name: 'Example DB Cloud',
      }),
    ).toEqual({
      field: 'advertiser_domain',
      message: expect.stringContaining('already registered as “Example DB Cloud”'),
    });
    expect(issueForFailure({ ok: false, error: 'app_not_found', appId: 'app_x' }).field).toBe(
      'app_id',
    );
    expect(issueForFailure({ ok: false, error: 'creative_not_found', creativeId: 'cr_x' })).toEqual(
      {
        field: 'form',
        message: 'That creative no longer exists.',
      },
    );
  });
});

describe('a form that names a new advertiser', () => {
  it('is passed through with the typed name and domain', async () => {
    const writer = recordingWriter();
    await saveCreative(
      writer,
      formOf({
        ...VALID,
        advertiser_id: NEW_ADVERTISER_VALUE,
        advertiser: 'Fresh Co',
        advertiser_domain: 'Fresh.example',
      }),
      CONTEXT,
    );
    expect(writer.calls[0]?.value.seed).toMatchObject({
      advertiser: 'Fresh Co',
      advertiser_domain: 'fresh.example',
    });
  });
});
