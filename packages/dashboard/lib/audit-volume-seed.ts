import { loadPolicyFromYaml, prefixedUlid } from '@adgate/core';
import type { Sql } from 'postgres';

/**
 * A LOT of records for one app, written in one INSERT ... generate_series. These are for the
 * pagination test, which is about rows and their order and nothing else, so the `record` column
 * is a placeholder: signing 1 200 documents would make the test slow and prove nothing extra
 * (what verify() says about a real record is lib/audit-verify.integration.test.ts's job).
 *
 * `perTimestamp` records SHARE a ts on purpose. A cursor on ts alone would then skip or repeat
 * rows at every page boundary that lands inside such a group, which is exactly the bug keyset
 * pagination on (ts, record_hash) - a unique pair, record_hash being the primary key - exists
 * to prevent.
 */
export interface SeedAuditVolumeOptions {
  count: number;
  perTimestamp: number;
  start: Date;
  appName?: string;
}

export const seedAuditVolume = async (
  sql: Sql,
  options: SeedAuditVolumeOptions,
): Promise<{ appId: string; appName: string }> => {
  const appId = prefixedUlid('app_');
  const appName = options.appName ?? 'Audit volume app';
  const yaml = `version: 1\napp_id: ${appId}\n`;
  const { policy_hash } = loadPolicyFromYaml(yaml);
  await sql`
    insert into apps (id, name, salt, policy_yaml, policy_hash, policy_version)
    values (${appId}, ${appName}, 'volume-salt', ${yaml}, ${policy_hash}, 1)
  `;
  await sql`
    insert into audit_records (record_hash, id, app_id, seq, prev_hash, is_latest,
      decision, reason, ts, record)
    select
      'sha256:' || lpad(n::text, 64, '0'),
      'aud_vol' || lpad(n::text, 19, '0'),
      ${appId},
      n,
      'genesis',
      true,
      case when n % 4 = 0 then 'serve' else 'suppress' end,
      case
        when n % 4 = 0 then null
        when n % 4 = 1 then 'no_fill'
        when n % 4 = 2 then 'paid_user'
        else 'sensitive_category:health'
      end,
      ${options.start.toISOString()}::timestamptz
        + (((n - 1) / ${options.perTimestamp}) * interval '1 hour'),
      '{}'::jsonb
    from generate_series(1, ${options.count}) as n
  `;
  return { appId, appName };
};
