import { creativeContentHash, type VerifyContext } from '@adgate/core';
import { AuditRecord } from '@adgate/schemas';
import { z } from 'zod';

import type { ReportAdvertiser, ReportDocument, ReportPeriod } from './report';

/**
 * The downloadable JSON bundle: the report document plus the evidence for it.
 *
 * IT MUST RE-VERIFY WITHOUT US. An advertiser who is told "your ads ran 400 times and the chain
 * is intact" should be able to check that claim on their own machine, with no access to adgate's
 * database and no network call, so the bundle carries everything docs/audit.md's eight checks
 * need:
 *
 *   records            the audit records the report is about, as they are stored;
 *   supporting_records the neighbours those checks read - each record's POSITIONAL predecessor
 *                      (the app's record at seq - 1), the record an attestation supersedes and
 *                      that record's own predecessor. Without them the `chain` check has nothing
 *                      to compare prev_hash against;
 *   creatives          the six content fields of every creative the records name, so
 *                      `creative_hash` can be recomputed rather than taken on trust. This is
 *                      also the only place the advertiser sees the copy that was actually
 *                      recorded against their name;
 *   public_keys        key_id -> SPKI PEM for `signature`. Public halves only: the bundle can
 *                      verify signatures and can never produce one.
 *
 * bundleVerifyContexts() below rebuilds each record's VerifyContext from the bundle's own
 * contents, positionally, exactly as packages/gateway/src/audit-api/verify-context.ts builds it
 * from Postgres. scripts/verify-bundle.ts runs it with core's verify() and nothing else;
 * lib/report-generate.integration.test.ts writes a real bundle to a file and runs that script.
 *
 * PURE: no database, no environment, no clock, no network.
 */

export const BUNDLE_VERSION = 1;

/**
 * The parser for a bundle FILE, which is untrusted input read off disk. It deliberately keeps
 * `report` as unknown: the offline verifier checks records, not the arithmetic, and a bundle
 * from a future version of the report document must still be verifiable.
 */
export const BundleRecordSchema = z.object({
  audit_id: z.string().min(1),
  app_id: z.string().min(1),
  /** Position in the app's chain. The predecessor is the entry at seq - 1. */
  seq: z.number().int().min(1),
  record_hash: z.string().min(1),
  is_latest: z.boolean(),
  ts: z.string().min(1),
  /** The signed document exactly as stored; verify() hashes this, so it is never reshaped. */
  record: z.unknown(),
});
export type BundleRecord = z.infer<typeof BundleRecordSchema>;

export const BundleCreativeSchema = z.object({
  id: z.string().min(1),
  advertiser: z.string(),
  advertiser_domain: z.string(),
  headline: z.string(),
  body: z.string(),
  cta: z.string(),
  url_template: z.string(),
});
export type BundleCreative = z.infer<typeof BundleCreativeSchema>;

export const ReportBundleSchema = z.object({
  bundle_version: z.literal(BUNDLE_VERSION),
  generated_at: z.string().min(1),
  report_id: z.string().min(1),
  advertiser: z.object({ id: z.string(), name: z.string(), domain: z.string() }),
  period: z.object({ start: z.string(), end: z.string() }),
  report: z.unknown(),
  records: z.array(BundleRecordSchema),
  supporting_records: z.array(BundleRecordSchema),
  creatives: z.array(BundleCreativeSchema),
  /** key_id -> SPKI PEM. Public keys only. */
  public_keys: z.record(z.string(), z.string()),
});
export type ReportBundleFile = z.infer<typeof ReportBundleSchema>;

/** The same document as we write it, with the report typed. */
export interface ReportBundle extends Omit<ReportBundleFile, 'report'> {
  report: ReportDocument;
}

export interface ReportBundleInput {
  reportId: string;
  generatedAt: string;
  advertiser: ReportAdvertiser;
  period: ReportPeriod;
  report: ReportDocument;
  records: readonly BundleRecord[];
  supportingRecords: readonly BundleRecord[];
  creatives: readonly BundleCreative[];
  publicKeys: Readonly<Record<string, string>>;
}

/** Sorted and de-duplicated so two bundles of the same data are byte-identical. */
const uniqueRecords = (records: readonly BundleRecord[]): BundleRecord[] => {
  const byHash = new Map<string, BundleRecord>();
  for (const record of records) {
    byHash.set(record.record_hash, record);
  }
  return [...byHash.values()].sort(
    (a, b) =>
      a.app_id.localeCompare(b.app_id) ||
      a.seq - b.seq ||
      a.record_hash.localeCompare(b.record_hash),
  );
};

export const buildReportBundle = (input: ReportBundleInput): ReportBundle => {
  const reported = new Set(input.records.map((record) => record.record_hash));
  return {
    bundle_version: BUNDLE_VERSION,
    generated_at: input.generatedAt,
    report_id: input.reportId,
    advertiser: input.advertiser,
    period: input.period,
    report: input.report,
    records: uniqueRecords(input.records),
    // A record that is already reported is never repeated in the supporting set.
    supporting_records: uniqueRecords(
      input.supportingRecords.filter((record) => !reported.has(record.record_hash)),
    ),
    creatives: [...input.creatives].sort((a, b) => a.id.localeCompare(b.id)),
    public_keys: Object.fromEntries(
      Object.entries(input.publicKeys).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
};

/* ------------------------------------------------------- rebuilding the verify context --- */

const positionKey = (appId: string, seq: number): string => `${appId}#${String(seq)}`;

/** Every record in the bundle, indexed the two ways the checks look one up. */
interface BundleIndex {
  byPosition: Map<string, BundleRecord>;
  byHash: Map<string, BundleRecord>;
  byId: Map<string, BundleRecord[]>;
  creativeHashes: Map<string, string>;
}

const indexBundle = (bundle: ReportBundleFile): BundleIndex => {
  const byPosition = new Map<string, BundleRecord>();
  const byHash = new Map<string, BundleRecord>();
  const byId = new Map<string, BundleRecord[]>();
  for (const record of [...bundle.records, ...bundle.supporting_records]) {
    byPosition.set(positionKey(record.app_id, record.seq), record);
    byHash.set(record.record_hash, record);
    byId.set(record.audit_id, [...(byId.get(record.audit_id) ?? []), record]);
  }
  const creativeHashes = new Map(
    bundle.creatives.map((creative) => [creative.id, creativeContentHash(creative)]),
  );
  return { byPosition, byHash, byId, creativeHashes };
};

/** The app's record at seq - 1, or null at the start of a chain or when it is not in the bundle. */
const predecessorOf = (index: BundleIndex, entry: BundleRecord): unknown => {
  if (entry.seq <= 1) {
    return null;
  }
  const previous = index.byPosition.get(positionKey(entry.app_id, entry.seq - 1));
  return previous === undefined ? null : previous.record;
};

/**
 * One record's VerifyContext, rebuilt from the bundle. The fields are read through
 * AuditRecord.safeParse rather than by poking at the raw object: a document that does not parse
 * fails the `schema` check and every later one whatever context it is given, so there is nothing
 * to gain from guessing at its shape.
 */
const bundleVerifyContext = (index: BundleIndex, entry: BundleRecord): VerifyContext => {
  const ctx: VerifyContext = {
    prevRecord: predecessorOf(index, entry) as VerifyContext['prevRecord'],
  };
  const parsed = AuditRecord.safeParse(entry.record);
  if (!parsed.success) {
    return ctx;
  }
  const record = parsed.data;

  if (record.creative !== null) {
    ctx.storedCreativeHash = index.creativeHashes.get(record.creative.id) ?? null;
  }

  if (record.supersedes_hash !== null) {
    const superseded = index.byHash.get(record.supersedes_hash);
    ctx.supersededRecord = (superseded?.record ?? null) as VerifyContext['supersededRecord'];
    if (superseded !== undefined) {
      ctx.superseded = {
        prevRecord: predecessorOf(index, superseded) as VerifyContext['prevRecord'],
      };
    }
  }

  if (!entry.is_latest) {
    const attestation = (index.byId.get(entry.audit_id) ?? []).find(
      (other) =>
        other.record_hash !== entry.record_hash &&
        AuditRecord.safeParse(other.record).data?.supersedes_hash === entry.record_hash,
    );
    if (attestation !== undefined) {
      ctx.supersededBy = attestation.record as VerifyContext['supersededBy'];
    }
  }

  return ctx;
};

/** The context of every reported record, by record_hash. */
export const bundleVerifyContexts = (bundle: ReportBundleFile): Map<string, VerifyContext> => {
  const index = indexBundle(bundle);
  return new Map(
    bundle.records.map((entry) => [entry.record_hash, bundleVerifyContext(index, entry)]),
  );
};
