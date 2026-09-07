import type { CatalogApp } from '@adgateio/gateway/admin';
import { describe, expect, it } from 'vitest';

import { type DeliverabilityRow, deliveryIndex, deliveryOf } from './deliverability';

/**
 * The judging half of lib/deliverability.ts, driven with hand written apps and creatives so the
 * rules are pinned without a database. What each reason MEANS is @adgateio/core's own test
 * (packages/core/src/demand/deliverability.test.ts); what is asserted here is the part this
 * package adds - one creative judged against SEVERAL apps, and which of several verdicts the
 * list page is supposed to show.
 */

const DEFAULTS = '';

/** Adds the impact network to the demand list the defaults would have produced. */
const WITH_IMPACT = [
  'demand:',
  '  - source: direct',
  '    enabled: true',
  '  - source: affiliate',
  '    network: partnerstack',
  '    enabled: true',
  '  - source: affiliate',
  '    network: impact',
  '    enabled: true',
].join('\n');

const app = (
  id: string,
  name: string,
  extra: string,
  affiliateConfig: CatalogApp['affiliateConfig'] = null,
): CatalogApp => ({
  id,
  name,
  policyYaml: ['version: 1', `app_id: ${id}`, extra, ''].join('\n'),
  affiliateConfig,
});

/** Default policy, no affiliate accounts: partnerstack is enabled but has nothing to credit. */
const PLAIN = app('app_plain', 'Plain', DEFAULTS);
/** Both affiliate networks enabled AND configured. */
const FULL = app('app_full', 'Full', WITH_IMPACT, {
  partnerstack: { program_id: 'ps' },
  impact: { program_id: 'imp' },
});

const creative = (over: Partial<DeliverabilityRow> = {}): DeliverabilityRow => ({
  id: 'cr_1',
  active: true,
  source: 'direct',
  network: null,
  targetCategories: ['software.devtools.database'],
  targetRegions: ['US'],
  appId: null,
  ...over,
});

const only = (rows: readonly DeliverabilityRow[], apps: readonly CatalogApp[]) =>
  deliveryOf(deliveryIndex(rows, apps), rows[0]?.id ?? '');

describe('deliveryIndex', () => {
  it('judges a shared creative against every app in scope', () => {
    const result = only([creative()], [PLAIN, FULL]);
    expect(result.judged).toBe(2);
    expect(result.blocked).toBe(0);
    expect(result.worst).toBeNull();
    expect(result.perApp.map((entry) => entry.appId)).toEqual(['app_plain', 'app_full']);
    expect(result.perApp.every((entry) => entry.deliverable)).toBe(true);
  });

  it('judges a private creative against its own app only', () => {
    const result = only([creative({ appId: 'app_full' })], [PLAIN, FULL]);
    expect(result.judged).toBe(1);
    expect(result.perApp[0]?.appId).toBe('app_full');
  });

  it('reports a creative that is deliverable for one app and blocked for another', () => {
    // impact is enabled and configured on FULL, and absent from PLAIN's default demand list.
    const result = only([creative({ source: 'affiliate', network: 'impact' })], [PLAIN, FULL]);
    expect(result.judged).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.worst?.appId).toBe('app_plain');
    expect(result.worst?.reason).toBe('network_not_enabled');
    // The sentence names the change, and it is core's, not a rewrite of it.
    expect(result.worst?.detail).toContain('add an affiliate entry for impact');
    expect(result.perApp.find((entry) => entry.appId === 'app_full')?.deliverable).toBe(true);
  });

  it('reports the affiliate config an app is missing, per app', () => {
    const result = only(
      [creative({ source: 'affiliate', network: 'partnerstack' })],
      [PLAIN, FULL],
    );
    expect(result.blocked).toBe(1);
    expect(result.worst?.reason).toBe('affiliate_not_configured');
    expect(result.worst?.detail).toContain('affiliate_config.partnerstack');
  });

  it('says `inactive` for a paused creative, whatever else is wrong with it', () => {
    const result = only(
      [creative({ active: false, source: 'affiliate', network: 'impact' })],
      [PLAIN],
    );
    expect(result.worst?.reason).toBe('inactive');
  });

  it('picks the reason an operator fixes first when apps disagree about why', () => {
    // PLAIN blocks it with network_not_enabled; a second app enables impact but cannot credit it,
    // which is affiliate_not_configured - later in the documented order, so the first one wins.
    const enabledButUnconfigured = app('app_half', 'Half', WITH_IMPACT);
    const result = only(
      [creative({ source: 'affiliate', network: 'impact' })],
      [PLAIN, enabledButUnconfigured],
    );
    expect(result.blocked).toBe(2);
    expect(result.worst?.reason).toBe('network_not_enabled');
  });

  it('blocks every creative of an app whose stored policy will not parse, and says so first', () => {
    const broken: CatalogApp = { ...PLAIN, policyYaml: 'app_id: x\nnot_a_key: 1\n' };
    const result = only([creative()], [broken, FULL]);
    expect(result.judged).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.worst?.reason).toBeNull();
    expect(result.worst?.detail).toContain('stored policy is unreadable');
  });

  it('gives a creative no app can judge an entry of its own rather than dropping it', () => {
    const result = only([creative()], []);
    expect(result).toEqual({ judged: 0, blocked: 0, worst: null, perApp: [] });
  });

  it('keys every creative it was given, and answers for an unknown id without throwing', () => {
    const rows = [creative({ id: 'cr_a' }), creative({ id: 'cr_b', active: false })];
    const index = deliveryIndex(rows, [PLAIN]);
    expect([...index.keys()].sort()).toEqual(['cr_a', 'cr_b']);
    expect(deliveryOf(index, 'cr_missing').judged).toBe(0);
  });

  it('does not judge one app’s private creative against another app', () => {
    const rows = [creative({ id: 'cr_mine', appId: 'app_full' })];
    const index = deliveryIndex(rows, [PLAIN, FULL]);
    expect(deliveryOf(index, 'cr_mine').perApp).toHaveLength(1);
  });
});
