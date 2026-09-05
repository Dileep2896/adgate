import type { Sql } from 'postgres';

/**
 * The fixture lib/metrics-queries.integration.test.ts runs against. Test-only: nothing in the
 * app imports it (the dashboard never writes - lib/db.ts).
 *
 * Two populations, for two different jobs:
 *
 *  - BULK: 50 apps and 10 000 audit records spread over 400 days, so the planner has real
 *    statistics. An EXPLAIN against three rows proves nothing - Postgres reads a tiny table
 *    sequentially whatever indexes exist - so the volume is what makes "does this query use
 *    audit_records_app_id_ts_idx" a question with an answer.
 *  - FIXTURE_APP: ten hand written turns in the last two days whose metrics are computed by
 *    hand in the test, plus one attestation row that must NOT be counted twice.
 */

/** 26 Crockford-ish characters so the ids look like the ULIDs the gateway mints. */
const pad = (value: string): string => value.padStart(26, '0');

export const BULK_APPS = 50;
export const BULK_RECORDS = 10_000;
/** One of the bulk apps: the EXPLAIN assertions use an app with a representative share of rows. */
export const BULK_APP_ID = `app_${pad('1')}`;
/** The hand written app. Its numbers are asserted; the bulk apps only feed the planner. */
export const FIXTURE_APP_ID = `app_${pad('99')}`;
/** Every serve in the fixture points at this creative. 3 impressions * 20 / 1000 = 0.06. */
export const FIXTURE_ECPM = 20;
/** The one advertiser both populations serve, so the report queries have volume to plan over. */
export const FIXTURE_ADVERTISER_ID = 'adv_metrics';

const HASH = (value: string): string => `sha256:${value.padStart(64, '0')}`;

/** decision, reason, whether an impression and a click follow, hours ago. */
const FIXTURE_TURNS: [string, string | null, 'none' | 'impression' | 'click', number][] = [
  ['serve', null, 'click', 1],
  ['serve', null, 'impression', 2],
  ['serve', null, 'impression', 25],
  ['serve', null, 'none', 26],
  ['suppress', 'no_fill', 'none', 3],
  ['suppress', 'no_fill', 'none', 27],
  ['suppress', 'paid_user', 'none', 4],
  ['suppress', 'sensitive_category:health', 'none', 5],
  ['suppress', 'frequency_cap', 'none', 28],
  ['suppress', 'error', 'none', 29],
];

export const truncateAll = async (sql: Sql): Promise<void> => {
  await sql.unsafe(
    'truncate table events, audit_records, retention_state, reports, creatives, advertisers, api_keys, apps restart identity cascade',
  );
};

/** Empties the database and writes both populations. Idempotent. */
export const seedMetricsFixture = async (sql: Sql): Promise<void> => {
  await truncateAll(sql);

  await sql.unsafe(
    `insert into apps (id, name, salt, policy_yaml, policy_hash)
     select 'app_' || lpad(i::text, 26, '0'), 'Bulk app ' || i, 'salt', 'version: 1', $1
     from generate_series(1, ${BULK_APPS}) as i`,
    [HASH('a')],
  );
  await sql.unsafe(
    `insert into apps (id, name, salt, policy_yaml, policy_hash) values ($1, 'Fixture app', 'salt', 'version: 1', $2)`,
    [FIXTURE_APP_ID, HASH('b')],
  );
  await sql.unsafe(
    `insert into advertisers (id, name, domain) values ('adv_metrics', 'Metrics advertiser', 'metrics.example')`,
  );
  await sql.unsafe(
    `insert into creatives (id, advertiser_id, headline, body, cta, url_template,
       target_categories, target_regions, keywords, ecpm, source, content_hash)
     values ('cr_metrics', 'adv_metrics', 'Headline', 'Body', 'Try it', 'https://metrics.example/',
       '{}', '{}', '{}', ${FIXTURE_ECPM}, 'direct', $1)`,
    [HASH('c')],
  );

  // ---- bulk: every third record serves, the rest alternate no_fill and paid_user ----
  await sql.unsafe(
    `insert into audit_records
       (record_hash, id, app_id, seq, prev_hash, is_latest, decision, reason, creative_id, advertiser_id, ts, record)
     select
       'sha256:' || lpad(n::text, 64, '0'),
       'aud_' || lpad(n::text, 26, '0'),
       'app_' || lpad((((n - 1) % ${BULK_APPS}) + 1)::text, 26, '0'),
       ((n - 1) / ${BULK_APPS}) + 1,
       'genesis',
       true,
       case when n % 3 = 0 then 'serve' else 'suppress' end,
       case when n % 3 = 0 then null when n % 3 = 1 then 'no_fill' else 'paid_user' end,
       case when n % 3 = 0 then 'cr_metrics' else null end,
       case when n % 3 = 0 then 'adv_metrics' else null end,
       now() - ((n % 400) * interval '1 day'),
       jsonb_build_object('pad', repeat('x', 300))
     from generate_series(1, ${BULK_RECORDS}) as n`,
  );
  await sql.unsafe(
    `insert into events (id, audit_id, app_id, type, ts)
     select
       'ev_' || lpad(n::text, 26, '0'),
       'aud_' || lpad(n::text, 26, '0'),
       'app_' || lpad((((n - 1) % ${BULK_APPS}) + 1)::text, 26, '0'),
       'impression',
       now() - ((n % 400) * interval '1 day')
     from generate_series(1, ${BULK_RECORDS}) as n
     where n % 3 = 0`,
  );

  // ---- the hand written app ----
  let seq = 0;
  for (const [decision, reason, event, hoursAgo] of FIXTURE_TURNS) {
    seq += 1;
    const auditId = `aud_fixture${pad(String(seq))}`;
    await sql.unsafe(
      `insert into audit_records
         (record_hash, id, app_id, seq, prev_hash, is_latest, decision, reason, creative_id, advertiser_id, ts, record)
       values ($1, $2, $3, $4, 'genesis', true, $5, $6, $7, $8, now() - ($9 * interval '1 hour'), '{}'::jsonb)`,
      [
        HASH(`f${seq}`),
        auditId,
        FIXTURE_APP_ID,
        seq,
        decision,
        reason,
        decision === 'serve' ? 'cr_metrics' : null,
        decision === 'serve' ? 'adv_metrics' : null,
        hoursAgo,
      ],
    );
    if (event !== 'none') {
      await sql.unsafe(
        `insert into events (id, audit_id, app_id, type, ts)
         values ($1, $2, $3, 'impression', now() - ($4 * interval '1 hour'))`,
        [`ev_i${pad(String(seq))}`, auditId, FIXTURE_APP_ID, hoursAgo],
      );
    }
    if (event === 'click') {
      await sql.unsafe(
        `insert into events (id, audit_id, app_id, type, ts)
         values ($1, $2, $3, 'click', now() - ($4 * interval '1 hour'))`,
        [`ev_c${pad(String(seq))}`, auditId, FIXTURE_APP_ID, hoursAgo],
      );
    }
  }

  // The attestation of the first turn: same audit id, a new record_hash, the old row demoted.
  // turns_evaluated must still be 10, which is what is_latest in the queries is for.
  await sql.unsafe(`update audit_records set is_latest = false where id = $1 and app_id = $2`, [
    `aud_fixture${pad('1')}`,
    FIXTURE_APP_ID,
  ]);
  await sql.unsafe(
    `insert into audit_records
       (record_hash, id, app_id, seq, prev_hash, supersedes_hash, is_latest, decision, reason,
        creative_id, advertiser_id, ts, record)
     values ($1, $2, $3, $4, $5, $5, true, 'serve', null, 'cr_metrics', 'adv_metrics',
       now() - interval '1 hour', '{}'::jsonb)`,
    [HASH('att1'), `aud_fixture${pad('1')}`, FIXTURE_APP_ID, FIXTURE_TURNS.length + 1, HASH('f1')],
  );

  await sql.unsafe(`analyze apps, audit_records, events, creatives, advertisers`);
};

/** One generated report, so "advertisers with a report" has something to count (S35 writes them). */
export const seedReport = async (sql: Sql): Promise<void> => {
  await sql.unsafe(
    `insert into reports (id, advertiser_id, period_start, period_end, report)
     values ('rep_metrics', 'adv_metrics', now() - interval '30 days', now(), '{}'::jsonb)`,
  );
};
