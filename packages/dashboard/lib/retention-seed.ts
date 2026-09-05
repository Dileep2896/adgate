import type { Sql } from 'postgres';

/**
 * What the gateway's retention job (S37) leaves behind, for the dashboard's integration tests:
 * the oldest chain positions of an app deleted, and one retention_state row saying how far it
 * got and under which cutoff.
 *
 * The job itself lives in packages/gateway/src/retention and its own integration tests assert
 * that it writes exactly these two columns. The dashboard cannot run it: lib/db.ts opens a
 * read-only pool on purpose, and giving a test a writable handle to a job that deletes audit
 * records would be a strange thing to keep in this package. So the fixture writes the state and
 * the test asserts what the READ side - loadAuditDetail, the real page data function - makes of
 * it. Test-only; nothing in the app imports this.
 */

export interface PrunedChain {
  appId: string;
  /** The highest chain position deleted. */
  throughSeq: number;
  /** The cutoff recorded; every surviving record must post-date it. */
  cutoff: Date;
}

export const prunedThrough = async (sql: Sql, pruned: PrunedChain): Promise<void> => {
  await sql`
    delete from audit_records where app_id = ${pruned.appId} and seq <= ${pruned.throughSeq}
  `;
  await sql`
    insert into retention_state (app_id, pruned_before, pruned_through_seq, updated_at)
    values (${pruned.appId}, ${pruned.cutoff.toISOString()}, ${pruned.throughSeq}, now())
    on conflict (app_id) do update
      set pruned_before = excluded.pruned_before,
          pruned_through_seq = excluded.pruned_through_seq,
          updated_at = now()
  `;
};
