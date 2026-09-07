import { AMAZON_MARKETPLACES } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import {
  affiliateFormValues,
  parseAffiliateValues,
  readAffiliateFormValues,
} from './affiliate-form';
import { AMAZON_MARKETPLACE_VALUES, EMPTY_AFFILIATE_VALUES } from './affiliate-issue';

/**
 * The affiliate form's rules, with no database and no React. The one that matters is the
 * half-filled entry: a campaign id with no program id, or a storefront with no tag, is exactly
 * what leaves an adapter answering `affiliate_not_configured` while the operator believes the
 * network is on.
 */

const values = (patch: Partial<typeof EMPTY_AFFILIATE_VALUES> = {}) => ({
  ...EMPTY_AFFILIATE_VALUES,
  ...patch,
});

const form = (fields: Record<string, unknown>) => ({
  get: (name: string) => fields[name] ?? null,
});

describe('the marketplace list the client component renders', () => {
  it('is the schema enum, in the schema order', () => {
    // The list is duplicated in lib/affiliate-issue.ts so the client component carries no zod;
    // this is what stops the copy drifting from the contract.
    expect(AMAZON_MARKETPLACE_VALUES).toEqual([...AMAZON_MARKETPLACES]);
  });
});

describe('readAffiliateFormValues', () => {
  it('trims every field and treats a missing one as empty', () => {
    expect(
      readAffiliateFormValues(
        form({ partnerstack_program_id: '  ps-1  ', amazon_tag: 'mysite-20' }),
      ),
    ).toEqual(values({ partnerstackProgramId: 'ps-1', amazonTag: 'mysite-20' }));
    expect(readAffiliateFormValues(form({}))).toEqual(EMPTY_AFFILIATE_VALUES);
    expect(readAffiliateFormValues(form({ amazon_tag: 42 }))).toEqual(EMPTY_AFFILIATE_VALUES);
  });
});

describe('parseAffiliateValues', () => {
  it('builds an entry per network that has an id, and omits the ones that do not', () => {
    const result = parseAffiliateValues(
      values({
        partnerstackProgramId: 'ps-1',
        impactProgramId: 'imp-9',
        impactCampaignId: 'camp-3',
        amazonTag: 'mysite-20',
        amazonMarketplace: 'co.uk',
      }),
    );
    expect(result).toEqual({
      ok: true,
      config: {
        partnerstack: { program_id: 'ps-1' },
        impact: { program_id: 'imp-9', campaign_id: 'camp-3' },
        amazon: { tag: 'mysite-20', marketplace: 'co.uk' },
      },
    });
  });

  it('an entirely blank form is a valid, EMPTY config - the way to switch every network off', () => {
    expect(parseAffiliateValues(EMPTY_AFFILIATE_VALUES)).toEqual({ ok: true, config: {} });
  });

  it('omits the optional fields rather than storing an empty string', () => {
    const result = parseAffiliateValues(
      values({ impactProgramId: 'imp-9', amazonTag: 'mysite-20' }),
    );
    expect(result).toEqual({
      ok: true,
      config: { impact: { program_id: 'imp-9' }, amazon: { tag: 'mysite-20' } },
    });
    // Not `campaign_id: undefined` or `marketplace: ''`: the schema is strict and the stored JSON
    // is compared by the adapters.
    expect(result.ok && 'campaign_id' in result.config.impact!).toBe(false);
    expect(result.ok && 'marketplace' in result.config.amazon!).toBe(false);
  });

  it('refuses a campaign id with no impact.com program id, and says which field to fix', () => {
    const result = parseAffiliateValues(values({ impactCampaignId: 'camp-3' }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.field).toBe('impact_program_id');
    expect(result.issues[0]?.message).toContain('program id');
  });

  it('refuses a storefront with no Associates tag', () => {
    const result = parseAffiliateValues(values({ amazonMarketplace: 'de' }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues[0]?.field).toBe('amazon_tag');
  });

  it('refuses a storefront that is not a real Amazon storefront', () => {
    const result = parseAffiliateValues(
      values({ amazonTag: 'mysite-20', amazonMarketplace: 'co.zz' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues[0]?.field).toBe('amazon_marketplace');
  });

  it('never repeats an identifier back inside an error message', () => {
    const result = parseAffiliateValues(
      values({ amazonTag: 'mysite-20', amazonMarketplace: 'co.zz' }),
    );
    if (result.ok) {
      throw new Error('expected a refusal');
    }
    for (const issue of result.issues) {
      expect(issue.message).not.toContain('mysite-20');
      expect(issue.message).not.toContain('co.zz');
    }
  });
});

describe('affiliateFormValues', () => {
  it('round trips a stored config back into the inputs', () => {
    const config = {
      partnerstack: { program_id: 'ps-1' },
      impact: { program_id: 'imp-9', campaign_id: 'camp-3' },
      amazon: { tag: 'mysite-20', marketplace: 'co.uk' as const },
    };
    const shown = affiliateFormValues(config);
    expect(shown).toEqual(
      values({
        partnerstackProgramId: 'ps-1',
        impactProgramId: 'imp-9',
        impactCampaignId: 'camp-3',
        amazonTag: 'mysite-20',
        amazonMarketplace: 'co.uk',
      }),
    );
    // What the form shows must parse back to what was stored, or a save with no edits would
    // silently change the configuration.
    expect(parseAffiliateValues(shown)).toEqual({ ok: true, config });
  });

  it('shows an unconfigured app an empty form', () => {
    expect(affiliateFormValues(null)).toEqual(EMPTY_AFFILIATE_VALUES);
    expect(affiliateFormValues(undefined)).toEqual(EMPTY_AFFILIATE_VALUES);
    expect(affiliateFormValues({})).toEqual(EMPTY_AFFILIATE_VALUES);
  });
});
