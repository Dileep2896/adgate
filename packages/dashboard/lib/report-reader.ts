import type { AuditReader, AuditRecordRow, RetentionWatermark } from '@adgate/gateway/audit';

/**
 * The plumbing one report generation runs on: a memoising wrapper around the gateway's
 * AuditReader, and a bounded parallel map. Split out of lib/report-generate.ts so that file
 * stays about what a report IS; neither function knows anything about reports.
 */

/**
 * The reader, with every lookup remembered for the life of one generation. buildVerifyContext
 * asks for the predecessor of every record and the bundle asks for the same rows again, and in a
 * chain of consecutive records most of those are each other - so without this a 2 000 record
 * report would run several thousand redundant single-row queries.
 */
export const cachedReader = (reader: AuditReader): AuditReader => {
  const bySeq = new Map<string, Promise<AuditRecordRow | null>>();
  const byHash = new Map<string, Promise<AuditRecordRow | null>>();
  const latest = new Map<string, Promise<AuditRecordRow | null>>();
  const creativeHashes = new Map<string, Promise<string | null>>();
  // One row per app, and a report is usually one app or a handful: asking once per record whose
  // predecessor retention pruned would be the same answer several hundred times.
  const watermarks = new Map<string, Promise<RetentionWatermark | null>>();
  const memo = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
    const existing = cache.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const loaded = load();
    cache.set(key, loaded);
    return loaded;
  };
  return {
    findVersion: (query) => reader.findVersion(query),
    findLatest: (auditId) => memo(latest, auditId, () => reader.findLatest(auditId)),
    findByHash: (recordHash) => memo(byHash, recordHash, () => reader.findByHash(recordHash)),
    findBySeq: (appId, seq) =>
      memo(bySeq, `${appId}#${String(seq)}`, () => reader.findBySeq(appId, seq)),
    creativeHash: (creativeId) =>
      memo(creativeHashes, creativeId, () => reader.creativeHash(creativeId)),
    retentionWatermark: (appId) => memo(watermarks, appId, () => reader.retentionWatermark(appId)),
  };
};

/** Runs `work` over the items, at most `limit` at a time, keeping the input order. */
export const mapLimited = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};
