import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedCreatives } from '../catalog/seed.js';
import { findRepoRoot } from '../env-file.js';
import { NO_FILL_BLOCKED_WARNING } from './deliverability-warning.js';
import { createHarness, evaluateBody, fixtureText, type Harness } from './test-support.js';

/**
 * The warning on the real evaluate path. The catalog is examples/affiliate-catalog.seed.json
 * and the app has no affiliate_config, so every turn ends in no_fill while the catalog looks
 * healthy. One warn line per (app, reason) must say why, and a busy gateway must not repeat it.
 */

const root = findRepoRoot();
if (root === null) {
  throw new Error('repo root not found');
}
const affiliateSeeds: unknown = JSON.parse(
  readFileSync(join(root, 'examples', 'affiliate-catalog.seed.json'), 'utf8'),
);

interface Line {
  level?: number;
  msg?: string;
  app_id?: string;
  reason?: string;
  creatives?: number;
  req_id?: string;
}

const warnings = (h: Harness): Line[] =>
  h.lines
    .map((line) => JSON.parse(line) as Line)
    .filter((line) => line.msg === NO_FILL_BLOCKED_WARNING);

describe('no_fill deliverability warning', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness({ seed: false });
    await seedCreatives(h.handle.db, affiliateSeeds as unknown[]);
  });

  beforeEach(async () => {
    await h.reset();
  });

  afterAll(async () => {
    await h.close();
  });

  const turn = async (conversationId: string, content: string) => {
    const response = await h.evaluate(
      evaluateBody(h.appId, { conversation_id: conversationId, turn_id: 't1', content }),
    );
    expect(response.decision).toBe('suppress');
    expect(response.reason).toBe('no_fill');
    return response;
  };

  it('names the reason and the count when matching creatives cannot serve', async () => {
    // c005 is a vector-database question: four partnerstack creatives target it, and this app
    // has no affiliate_config, so all four are ineligible for a reason nothing else reports.
    await turn('conv_a', fixtureText('c005'));
    const lines = warnings(h);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 40,
      app_id: h.appId,
      reason: 'affiliate_not_configured',
      creatives: 4,
      msg: NO_FILL_BLOCKED_WARNING,
    });
    // It goes through the request-scoped child logger, so it ties back to one turn.
    expect(lines[0]?.req_id).toEqual(expect.any(String));
  });

  it('says each reason once per app however many turns no_fill', async () => {
    await turn('conv_a', fixtureText('c005'));
    await turn('conv_b', fixtureText('c005'));
    await turn('conv_c', fixtureText('c005'));
    expect(warnings(h)).toHaveLength(1);
  });

  it('adds a line for a second reason a later turn uncovers', async () => {
    await turn('conv_a', fixtureText('c005'));
    // c010 is a password-manager question; the only creative targeting software.security is on
    // the impact network, which the default policy demand list does not enable.
    await turn('conv_b', fixtureText('c010'));
    const reasons = warnings(h).map((line) => line.reason);
    expect(reasons).toEqual(['affiliate_not_configured', 'network_not_enabled']);
  });

  it('never carries creative copy, an advertiser domain or message text', async () => {
    await turn('conv_a', fixtureText('c001'));
    expect(warnings(h)).not.toHaveLength(0);
    for (const line of warnings(h)) {
      const text = JSON.stringify(line);
      expect(text).not.toContain('Managed Postgres');
      expect(text).not.toContain('partner-postgres.example');
      expect(text).not.toContain('side project');
    }
  });

  it('stays silent when nothing in the catalog matched the turn', async () => {
    // A language-learning question: no creative in this catalog targets that category.
    await turn('conv_a', fixtureText('c019'));
    expect(warnings(h)).toEqual([]);
  });
});
