import { describe, expect, it } from 'vitest';

import {
  appReadiness,
  blockedLines,
  type CatalogApp,
  groupBlocked,
  readinessLines,
  type ReadinessCreative,
  type ReadinessRow,
} from './readiness.js';

/**
 * Readiness grouping and rendering, with no database: the same twelve-creative catalog that
 * measured 26% fill, judged against two apps whose policies differ only in their demand list.
 */

const DEFAULT_POLICY = ['version: 1', 'app_id: app_default', ''].join('\n');

const IMPACT_POLICY = [
  'version: 1',
  'app_id: app_impact',
  'demand:',
  '  - source: direct',
  '    enabled: true',
  '  - source: affiliate',
  '    network: partnerstack',
  '    enabled: true',
  '  - source: affiliate',
  '    network: impact',
  '    enabled: true',
  '',
].join('\n');

const app = (patch: Partial<CatalogApp> = {}): CatalogApp => ({
  id: 'app_default',
  name: 'Default App',
  policyYaml: DEFAULT_POLICY,
  affiliateConfig: { partnerstack: { program_id: 'ps_1' } },
  ...patch,
});

const affiliate = (label: string, network: 'partnerstack' | 'impact'): ReadinessCreative => ({
  label,
  creative: {
    active: true,
    source: 'affiliate',
    network,
    target_categories: ['software.devtools.database'],
    target_regions: ['US', 'CA', 'GB', 'EU'],
  },
});

/** Eight partnerstack and four impact creatives: the shape of the catalog that was measured. */
const catalog: ReadinessCreative[] = [
  ...Array.from({ length: 8 }, (_, i) => affiliate(`ps_${String(i)}`, 'partnerstack')),
  ...Array.from({ length: 4 }, (_, i) => affiliate(`imp_${String(i)}`, 'impact')),
];

const row = (label: string, result: ReadinessRow['result']): ReadinessRow => ({ label, result });

describe('groupBlocked', () => {
  it('counts distinct (reason, detail) pairs, most creatives first', () => {
    const groups = groupBlocked([
      row('a', { deliverable: false, reason: 'network_not_enabled', detail: 'impact' }),
      row('b', { deliverable: true }),
      row('c', { deliverable: false, reason: 'network_not_enabled', detail: 'impact' }),
      row('d', { deliverable: false, reason: 'inactive', detail: 'paused' }),
    ]);
    expect(groups).toEqual([
      { reason: 'network_not_enabled', detail: 'impact', count: 2 },
      { reason: 'inactive', detail: 'paused', count: 1 },
    ]);
  });

  it('is empty when every creative can serve', () => {
    expect(groupBlocked([row('a', { deliverable: true })])).toEqual([]);
  });
});

describe('appReadiness', () => {
  it('reports the impact creatives as network_not_enabled under the default policy', () => {
    const readiness = appReadiness(app(), catalog);
    expect(readiness.total).toBe(12);
    expect(readiness.deliverable).toBe(8);
    expect(readiness.blocked).toHaveLength(1);
    const [group] = readiness.blocked;
    expect(group?.reason).toBe('network_not_enabled');
    expect(group?.count).toBe(4);
    expect(group?.detail).toContain('impact');
  });

  it('reports every creative as affiliate_not_configured when the app has no config', () => {
    const readiness = appReadiness(app({ affiliateConfig: null }), catalog);
    expect(readiness.deliverable).toBe(0);
    // The impact creatives still fail on the network first: the earlier reason wins.
    expect(readiness.blocked.map((group) => group.reason)).toEqual([
      'affiliate_not_configured',
      'network_not_enabled',
    ]);
    expect(readiness.blocked[0]?.count).toBe(8);
    expect(readiness.blocked[1]?.count).toBe(4);
  });

  it('is per app: enabling impact and configuring it unblocks the same four creatives', () => {
    const readiness = appReadiness(
      app({
        id: 'app_impact',
        name: 'Impact App',
        policyYaml: IMPACT_POLICY,
        affiliateConfig: { partnerstack: { program_id: 'ps_1' }, impact: { program_id: 'im_1' } },
      }),
      catalog,
    );
    expect(readiness.deliverable).toBe(12);
    expect(readiness.blocked).toEqual([]);
  });

  it('reports an unreadable stored policy instead of throwing', () => {
    const readiness = appReadiness(app({ policyYaml: 'version: 2\napp_id: x\n' }), catalog);
    expect(readiness.error).toContain('unreadable');
    expect(readiness.rows).toEqual([]);
    expect(readiness.deliverable).toBe(0);
    expect(readinessLines(readiness)).toEqual(['  app_default (Default App): ' + readiness.error]);
  });
});

describe('rendering', () => {
  it('names the count, the reason and the fix on one line', () => {
    const readiness = appReadiness(app(), catalog);
    const [line] = blockedLines(readiness);
    expect(line).toContain('4 blocked: network_not_enabled');
    expect(line).toContain('impact');
    expect(line).toContain('policy demand list');
  });

  it('heads each app with how many of its creatives can serve', () => {
    const lines = readinessLines(appReadiness(app(), catalog));
    expect(lines[0]).toBe('  app_default (Default App): 8 of 12 creatives can serve');
    expect(lines).toHaveLength(2);
  });
});
