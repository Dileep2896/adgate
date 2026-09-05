import { AffiliateNetwork, DemandSource } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import {
  type CreativeFormContext,
  DOMAIN_PATTERN,
  isKnownTargetCategory,
  MAX_ECPM,
  parseCreativeForm,
  splitList,
} from './creative-form';
import {
  AFFILIATE_NETWORK_VALUES,
  type CreativeField,
  CREATIVE_SOURCE_VALUES,
  NEW_ADVERTISER_VALUE,
} from './creative-issue';

/**
 * Every rule of the creative editor, without a browser or a database. The form is the only
 * thing standing between an operator and a catalog row the demand adapters would skip, so each
 * invalid field is checked one at a time and the valid case is checked field by field.
 */

const APP_ID = 'app_01J0000000000000000000000A';

const CONTEXT: CreativeFormContext = {
  advertisers: [
    { id: 'adv_1', name: 'Example DB Cloud', domain: 'exampledb.dev' },
    { id: 'adv_2', name: 'Example Deploy', domain: 'exampledeploy.dev' },
  ],
  appIds: [APP_ID],
};

/** A FormData-shaped stub. Absent fields answer null, exactly like FormData.get does. */
const formOf = (fields: Record<string, string>) => ({
  get: (name: string): unknown => fields[name] ?? null,
});

const VALID: Record<string, string> = {
  advertiser_id: NEW_ADVERTISER_VALUE,
  advertiser: 'New Advertiser',
  advertiser_domain: 'NewAdvertiser.example',
  headline: 'Managed Postgres with a free tier',
  body: 'Spin up a database in 30 seconds.',
  cta: 'Try it free',
  url_template: 'https://newadvertiser.example/?ref=adgate',
  target_categories: 'software.devtools.database, software.devtools.database\nsoftware.security',
  target_regions: 'us, ca, EU',
  keywords: 'postgres, database',
  ecpm: '12.5',
  source: 'direct',
  active: 'on',
  app_id: '',
};

const parse = (patch: Record<string, string> = {}, context: CreativeFormContext = CONTEXT) =>
  parseCreativeForm(formOf({ ...VALID, ...patch }), context);

/** The issues raised for one field, as messages. */
const messagesFor = (
  result: ReturnType<typeof parseCreativeForm>,
  field: CreativeField,
): string[] =>
  result.ok ? [] : result.issues.filter((i) => i.field === field).map((i) => i.message);

const fieldsOf = (result: ReturnType<typeof parseCreativeForm>): CreativeField[] =>
  result.ok ? [] : result.issues.map((issue) => issue.field);

describe('the option lists the client form renders', () => {
  it('are the contract enums, so a new source or network cannot go missing', () => {
    expect(AFFILIATE_NETWORK_VALUES).toEqual(AffiliateNetwork.options);
    // koah and gravity are network stubs with no catalog rows: not editable creatives.
    expect(CREATIVE_SOURCE_VALUES.every((source) => DemandSource.options.includes(source))).toBe(
      true,
    );
  });
});

describe('parseCreativeForm on a complete direct creative', () => {
  it('returns a SeedCreative with the lists split, deduped and normalized', () => {
    const result = parse();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.id).toBeNull();
    expect(result.value.appId).toBeNull();
    expect(result.value.seed).toEqual({
      advertiser: 'New Advertiser',
      // The domain is the advertiser's identity, so it is stored lower cased.
      advertiser_domain: 'newadvertiser.example',
      headline: 'Managed Postgres with a free tier',
      body: 'Spin up a database in 30 seconds.',
      cta: 'Try it free',
      url_template: 'https://newadvertiser.example/?ref=adgate',
      target_categories: ['software.devtools.database', 'software.security'],
      target_regions: ['US', 'CA', 'EU'],
      keywords: ['postgres', 'database'],
      ecpm: 12.5,
      source: 'direct',
      active: true,
    });
  });

  it('carries the edited id and the private catalog when they are set', () => {
    const result = parse({ id: 'cr_1', app_id: APP_ID });
    expect(result.ok && result.value.id).toBe('cr_1');
    expect(result.ok && result.value.appId).toBe(APP_ID);
  });

  it('treats an unchecked active box as paused and blank body as empty', () => {
    const result = parse({ active: '', body: '' });
    expect(result.ok && result.value.seed.active).toBe(false);
    expect(result.ok && result.value.seed.body).toBe('');
  });

  it('reuses an advertiser chosen from the list and ignores the typed name', () => {
    const result = parse({
      advertiser_id: 'adv_1',
      advertiser: 'Something else',
      advertiser_domain: 'somethingelse.example',
    });
    expect(result.ok && result.value.seed.advertiser).toBe('Example DB Cloud');
    expect(result.ok && result.value.seed.advertiser_domain).toBe('exampledb.dev');
  });

  it('accepts a new creative for an advertiser that exists under the same name', () => {
    const result = parse({ advertiser: 'Example DB Cloud', advertiser_domain: 'exampledb.dev' });
    expect(result.ok).toBe(true);
  });
});

describe('the one name per domain rule', () => {
  it('refuses a second name for a domain that is already registered', () => {
    const result = parse({ advertiser: 'Impostor DB', advertiser_domain: 'ExampleDB.dev' });
    expect(result.ok).toBe(false);
    expect(messagesFor(result, 'advertiser_domain')[0]).toContain(
      'already registered as “Example DB Cloud”',
    );
  });

  it('refuses an advertiser id that is not in the database', () => {
    const result = parse({ advertiser_id: 'adv_gone' });
    expect(fieldsOf(result)).toEqual(['advertiser_id']);
  });

  it('refuses a blank name, a blank domain and a domain that is a URL', () => {
    expect(fieldsOf(parse({ advertiser: '  ' }))).toEqual(['advertiser']);
    expect(fieldsOf(parse({ advertiser_domain: '' }))).toEqual(['advertiser_domain']);
    expect(
      messagesFor(parse({ advertiser_domain: 'https://x.dev/' }), 'advertiser_domain')[0],
    ).toContain('A domain only');
    expect(DOMAIN_PATTERN.test('exampledb.dev')).toBe(true);
    expect(DOMAIN_PATTERN.test('localhost')).toBe(false);
  });
});

describe('the copy and destination fields', () => {
  it('requires a headline, a call to action and a destination', () => {
    expect(fieldsOf(parse({ headline: '   ' }))).toEqual(['headline']);
    expect(fieldsOf(parse({ cta: '' }))).toEqual(['cta']);
    expect(fieldsOf(parse({ url_template: '' }))).toEqual(['url_template']);
  });

  it('refuses a destination that is not an absolute http(s) URL', () => {
    for (const url of ['/relative', 'javascript:alert(1)', 'ftp://x.dev/', 'exampledb.dev']) {
      expect(messagesFor(parse({ url_template: url }), 'url_template')[0]).toContain(
        'absolute http(s) URL',
      );
    }
  });

  it('accepts an affiliate template with placeholders', () => {
    const result = parse({
      source: 'affiliate',
      network: 'partnerstack',
      url_template: 'https://partner.example/track?pid={{program_id}}&u={{u}}',
    });
    expect(result.ok).toBe(true);
  });

  it('refuses text that is far longer than a creative slot', () => {
    expect(fieldsOf(parse({ headline: 'x'.repeat(201) }))).toEqual(['headline']);
    expect(fieldsOf(parse({ body: 'x'.repeat(501) }))).toEqual(['body']);
    expect(fieldsOf(parse({ cta: 'x'.repeat(61) }))).toEqual(['cta']);
  });
});

describe('target categories', () => {
  it('accepts the trailing wildcard form and rejects one that matches no category', () => {
    expect(isKnownTargetCategory('software.devtools.*')).toBe(true);
    expect(isKnownTargetCategory('software.*')).toBe(true);
    expect(isKnownTargetCategory('general.*')).toBe(false);
    expect(isKnownTargetCategory('software.devtools')).toBe(false);
    expect(parse({ target_categories: 'software.devtools.*' }).ok).toBe(true);
    expect(
      messagesFor(parse({ target_categories: 'general.*' }), 'target_categories')[0],
    ).toContain('Not in the taxonomy');
  });

  it('rejects a category outside the taxonomy and one the pattern refuses', () => {
    expect(fieldsOf(parse({ target_categories: 'software.devtools.databse' }))).toEqual([
      'target_categories',
    ]);
    expect(fieldsOf(parse({ target_categories: 'Software.Devtools' }))).toEqual([
      'target_categories',
    ]);
  });

  it('rejects an empty list: it would match nothing and never serve', () => {
    expect(messagesFor(parse({ target_categories: ' , ' }), 'target_categories')[0]).toContain(
      'at least one category',
    );
  });
});

describe('target regions and eCPM', () => {
  it('accepts an empty region list as everywhere and upper cases what it is given', () => {
    const result = parse({ target_regions: '' });
    expect(result.ok && result.value.seed.target_regions).toEqual([]);
    expect(parse({ target_regions: 'gb' }).ok).toBe(true);
  });

  it('rejects anything that is not two letters or EU', () => {
    expect(messagesFor(parse({ target_regions: 'USA, DE' }), 'target_regions')[0]).toContain('USA');
  });

  it('rejects a missing, non-numeric, negative or absurd eCPM', () => {
    expect(fieldsOf(parse({ ecpm: '' }))).toEqual(['ecpm']);
    expect(fieldsOf(parse({ ecpm: 'free' }))).toEqual(['ecpm']);
    expect(messagesFor(parse({ ecpm: '-1' }), 'ecpm')[0]).toContain('negative');
    expect(fieldsOf(parse({ ecpm: String(MAX_ECPM * 10) }))).toEqual(['ecpm']);
    expect(parse({ ecpm: '0' }).ok).toBe(true);
  });
});

describe('source, network and app scope', () => {
  it('requires a network on an affiliate creative', () => {
    expect(messagesFor(parse({ source: 'affiliate', network: '' }), 'network')[0]).toContain(
      'must name its network',
    );
    expect(fieldsOf(parse({ source: 'affiliate', network: 'linkshare' }))).toEqual(['network']);
  });

  it('keeps the network and program id of an affiliate creative', () => {
    const result = parse({ source: 'affiliate', network: 'impact', program_id: 'prog_7' });
    expect(result.ok && result.value.seed.network).toBe('impact');
    expect(result.ok && result.value.seed.program_id).toBe('prog_7');
  });

  it('drops the network and program id of a direct creative', () => {
    const result = parse({ source: 'direct', network: 'impact', program_id: 'prog_7' });
    expect(result.ok && result.value.seed.network).toBeUndefined();
    expect(result.ok && result.value.seed.program_id).toBeUndefined();
  });

  it('rejects a source that is not a catalog source', () => {
    expect(fieldsOf(parse({ source: 'koah' }))).toEqual(['source']);
    expect(fieldsOf(parse({ source: '' }))).toEqual(['source']);
  });

  it('rejects an app scope that names an app the gateway does not know', () => {
    expect(fieldsOf(parse({ app_id: 'app_gone' }))).toEqual(['app_id']);
  });
});

describe('splitList', () => {
  it('splits on commas and newlines, trims, drops blanks and collapses duplicates', () => {
    expect(splitList(' a, b\nc ,, a\n')).toEqual(['a', 'b', 'c']);
    expect(splitList('   ')).toEqual([]);
  });
});
