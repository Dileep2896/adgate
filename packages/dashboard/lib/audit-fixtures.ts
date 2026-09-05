import { creativeContentHash } from '@adgate/core';
import type { Candidate } from '@adgate/schemas';
import type { Sql } from 'postgres';

/**
 * The catalog the seeded audit chains serve from: TWO advertisers, because one is not enough to
 * catch the mistakes that matter.
 *
 * A chain is a single app's record sequence, and the apps adgate sits in front of serve whoever
 * won that turn - so the record before one advertiser's serve usually belongs to a DIFFERENT
 * advertiser. Anything that walks the chain (a verification report and, above all, the bundle it
 * hands to an advertiser) has to be tested against that shape, or a leak between two competitors
 * looks exactly like a passing test. lib/audit-seed.ts writes the chains; this is what they name.
 *
 * Test-only: nothing in the app imports it (the dashboard never writes - lib/db.ts).
 */

export const CREATIVE_ID = 'cr_audit_fixture';
export const ADVERTISER_ID = 'adv_audit_fixture';
export const ADVERTISER_NAME = 'Audit Fixture Co';
export const ADVERTISER_DOMAIN = 'auditfixture.example';
export const HEADLINE = 'Managed Postgres with a free tier';

/** The catalog row every serve in the fixture points at, as the demand path would hand it over. */
export const FIXTURE_CANDIDATE: Candidate = {
  id: CREATIVE_ID,
  advertiser: ADVERTISER_NAME,
  advertiser_domain: ADVERTISER_DOMAIN,
  headline: HEADLINE,
  body: 'Spin up a database in 30 seconds.',
  cta: 'Try it free',
  url_template: `https://${ADVERTISER_DOMAIN}/?ref=adgate`,
  target_categories: ['software.devtools.database'],
  target_regions: [],
  keywords: ['postgres'],
  ecpm: 20,
  source: 'direct',
  active: true,
  ecpm_estimate: 20,
  targeting_match: 0.85,
  resolved_url: `https://${ADVERTISER_DOMAIN}/?ref=adgate`,
};

/**
 * THE OTHER ADVERTISER: a competitor of nobody in particular, whose serves sit in the same
 * chain. Every string here is distinctive on purpose, so a test can assert that not one of them
 * appears in a bundle built for the advertiser above.
 */
export const OTHER_CREATIVE_ID = 'cr_rival_fixture';
export const OTHER_ADVERTISER_ID = 'adv_rival_fixture';
export const OTHER_ADVERTISER_NAME = 'Rival Analytics Ltd';
export const OTHER_ADVERTISER_DOMAIN = 'rivalanalytics.example';
export const OTHER_HEADLINE = 'Rival dashboards for busy finance teams';

export const OTHER_CANDIDATE: Candidate = {
  id: OTHER_CREATIVE_ID,
  advertiser: OTHER_ADVERTISER_NAME,
  advertiser_domain: OTHER_ADVERTISER_DOMAIN,
  headline: OTHER_HEADLINE,
  body: 'Close the quarter in an afternoon.',
  cta: 'Book a rival demo',
  url_template: `https://${OTHER_ADVERTISER_DOMAIN}/?ref=adgate`,
  target_categories: ['shopping.sportswear'],
  target_regions: [],
  keywords: ['rivalkeyword'],
  ecpm: 31,
  source: 'direct',
  active: true,
  ecpm_estimate: 31,
  targeting_match: 0.77,
  resolved_url: `https://${OTHER_ADVERTISER_DOMAIN}/?ref=adgate`,
};

/** content_hash of each fixture creative: the value the catalog row and the record both carry. */
export const FIXTURE_CONTENT_HASH = creativeContentHash(FIXTURE_CANDIDATE);
export const OTHER_CONTENT_HASH = creativeContentHash(OTHER_CANDIDATE);

/** Which advertiser owns a creative, for the audit_records.advertiser_id column. */
export const advertiserIdOfCreative = (creativeId: string | null): string | null => {
  if (creativeId === null) {
    return null;
  }
  return creativeId === OTHER_CREATIVE_ID ? OTHER_ADVERTISER_ID : ADVERTISER_ID;
};

const insertAdvertiser = async (
  sql: Sql,
  id: string,
  name: string,
  domain: string,
): Promise<void> => {
  await sql`
    insert into advertisers (id, name, domain)
    values (${id}, ${name}, ${domain})
    on conflict (id) do nothing
  `;
};

const insertCreative = async (
  sql: Sql,
  candidate: Candidate,
  advertiserId: string,
  contentHash: string,
): Promise<void> => {
  await sql`
    insert into creatives (id, advertiser_id, headline, body, cta, url_template,
      target_categories, target_regions, keywords, ecpm, source, content_hash)
    values (${candidate.id}, ${advertiserId}, ${candidate.headline}, ${candidate.body},
      ${candidate.cta}, ${candidate.url_template},
      ${sql.array([...candidate.target_categories])},
      ${sql.array([...candidate.target_regions])},
      ${sql.array([...candidate.keywords])},
      ${candidate.ecpm}, 'direct', ${contentHash})
    on conflict (id) do nothing
  `;
};

/** Both advertisers and both creatives, idempotently. Called before every seeded chain. */
export const insertFixtureCatalog = async (sql: Sql): Promise<void> => {
  await insertAdvertiser(sql, ADVERTISER_ID, ADVERTISER_NAME, ADVERTISER_DOMAIN);
  await insertCreative(sql, FIXTURE_CANDIDATE, ADVERTISER_ID, FIXTURE_CONTENT_HASH);
  await insertAdvertiser(sql, OTHER_ADVERTISER_ID, OTHER_ADVERTISER_NAME, OTHER_ADVERTISER_DOMAIN);
  await insertCreative(sql, OTHER_CANDIDATE, OTHER_ADVERTISER_ID, OTHER_CONTENT_HASH);
};
