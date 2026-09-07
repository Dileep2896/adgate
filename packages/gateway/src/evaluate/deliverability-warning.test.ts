import { type CatalogCreative, type Classification, PolicyConfig } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { createLogger, type Logger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import {
  blockedReasonCounts,
  createDeliverabilityWarner,
  NO_FILL_BLOCKED_WARNING,
} from './deliverability-warning.js';

/**
 * The no_fill warning: one warn line per (app, reason), only for creatives that MATCHED the
 * turn, and never carrying copy or message text.
 */

const policy = PolicyConfig.parse({ app_id: 'app_1' });

const creative = (patch: Partial<CatalogCreative> = {}): CatalogCreative => ({
  id: 'cr_1',
  advertiser: 'Partner Postgres',
  advertiser_domain: 'partner-postgres.example',
  headline: 'Managed Postgres that scales to zero',
  body: 'Branching databases and a free tier that stays free.',
  cta: 'See the free tier',
  url_template: 'https://partner-postgres.example/?ref={{program_id}}',
  target_categories: ['software.devtools.database'],
  target_regions: ['US', 'CA', 'GB', 'EU'],
  keywords: ['managed postgres'],
  ecpm: 14,
  source: 'affiliate',
  network: 'partnerstack',
  active: true,
  ...patch,
});

const database: Pick<Classification, 'categories'> = {
  categories: ['software.devtools.database'],
};

interface Capture {
  log: Logger;
  lines: () => Record<string, unknown>[];
}

const capture = (): Capture => {
  const logs = collectLogs();
  return {
    log: createLogger({ level: 'info' }, logs.stream),
    lines: () => logs.lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
};

describe('blockedReasonCounts', () => {
  it('counts only creatives that matched the turn’s categories', () => {
    const counts = blockedReasonCounts({
      catalog: [
        creative({ id: 'cr_1' }),
        creative({ id: 'cr_2' }),
        // A different category: never a candidate for this turn, so never a finding.
        creative({ id: 'cr_3', target_categories: ['travel.hotels'] }),
      ],
      classification: database,
      policy,
      affiliateConfig: {},
    });
    expect([...counts]).toEqual([['affiliate_not_configured', 2]]);
  });

  it('separates the two failures that look identical in the catalog', () => {
    const counts = blockedReasonCounts({
      catalog: [
        creative({ id: 'cr_1', network: 'partnerstack' }),
        creative({ id: 'cr_2', network: 'impact' }),
        creative({ id: 'cr_3', network: 'impact' }),
      ],
      classification: database,
      policy,
      affiliateConfig: {},
    });
    expect([...counts]).toEqual([
      ['network_not_enabled', 2],
      ['affiliate_not_configured', 1],
    ]);
  });

  it('is empty when every matching creative can serve', () => {
    const counts = blockedReasonCounts({
      catalog: [creative()],
      classification: database,
      policy,
      affiliateConfig: { partnerstack: { program_id: 'ps_1' } },
    });
    expect([...counts]).toEqual([]);
  });
});

describe('createDeliverabilityWarner', () => {
  const input = (appId: string, log: Logger) => ({
    appId,
    catalog: [creative({ id: 'cr_1' }), creative({ id: 'cr_2', network: 'impact' })],
    classification: database,
    policy,
    affiliateConfig: {},
    log,
  });

  it('logs one warn line per reason with the app id and the count', () => {
    const { log, lines } = capture();
    createDeliverabilityWarner().warnNoFill(input('app_1', log));
    const warnings = lines();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({
      level: 40,
      app_id: 'app_1',
      reason: 'network_not_enabled',
      creatives: 1,
      msg: NO_FILL_BLOCKED_WARNING,
    });
    expect(warnings[1]).toMatchObject({ reason: 'affiliate_not_configured', creatives: 1 });
  });

  it('says each reason once per app, however many turns no_fill', () => {
    const { log, lines } = capture();
    const warner = createDeliverabilityWarner();
    for (let turn = 0; turn < 25; turn += 1) {
      warner.warnNoFill(input('app_1', log));
    }
    expect(lines()).toHaveLength(2);
    expect(warner.size).toBe(2);
    // A second app is a second tenant's problem and gets its own lines.
    warner.warnNoFill(input('app_2', log));
    expect(lines()).toHaveLength(4);
    warner.clear();
    warner.warnNoFill(input('app_1', log));
    expect(lines()).toHaveLength(6);
  });

  it('never logs creative copy or a category', () => {
    const { log, lines } = capture();
    createDeliverabilityWarner().warnNoFill(input('app_1', log));
    for (const line of lines()) {
      const text = JSON.stringify(line);
      expect(text).not.toContain('Managed Postgres');
      expect(text).not.toContain('partner-postgres.example');
      expect(text).not.toContain('software.devtools.database');
    }
  });

  it('swallows its own failure: a diagnostic never changes the turn', () => {
    const { log, lines } = capture();
    const warner = createDeliverabilityWarner();
    expect(() =>
      warner.warnNoFill({
        ...input('app_1', log),
        // A policy the diagnostic cannot read at all.
        policy: null as unknown as typeof policy,
      }),
    ).not.toThrow();
    expect(lines()).toEqual([]);
  });
});
