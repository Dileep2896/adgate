import { creativeContentHash, type VerifyContext } from '@adgateio/core';
import { AuditRecord } from '@adgateio/schemas';
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
 *
 *                      A PREDECESSOR IS A REFERENCE, NOT A DOCUMENT. An app's chain interleaves
 *                      every advertiser it served, so the record before one advertiser's serve
 *                      is usually a COMPETITOR's: shipping it whole would hand advertiser A
 *                      advertiser B's creative id, name, domain, the categories of the turn and
 *                      the competitor exclusions that were applied. core's checkChain reads two
 *                      fields of a predecessor - record_hash and app_id - so that is all a
 *                      predecessor-only entry carries, marked `redacted`. The full document is
 *                      kept only for a SUPERSEDED VERSION of a record in the report, which is a
 *                      version of the advertiser's own turn and is verified in full;
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
  /**
   * The signed document exactly as stored; verify() hashes this, so it is never reshaped.
   * On a `redacted` entry it is the chain reference instead: { record_hash, app_id }.
   */
  record: z.unknown(),
  /**
   * True when `record` is a chain reference rather than the document: this row is in the bundle
   * only so a reported record's `chain` check has something to compare prev_hash against, and it
   * belongs to a turn that is not this advertiser's. Absent means a full document.
   */
  redacted: z.boolean().optional(),
});
export type BundleRecord = z.infer<typeof BundleRecordSchema>;

/** Why a supporting record is in the bundle, which decides how much of it is carried. */
export type SupportingRole = 'predecessor' | 'superseded';

export interface SupportingRecord extends BundleRecord {
  role: SupportingRole;
}

/** The two fields core's checkChain reads off a predecessor, and nothing else. */
export const chainReference = (record: BundleRecord): BundleRecord => ({
  audit_id: record.audit_id,
  app_id: record.app_id,
  seq: record.seq,
  record_hash: record.record_hash,
  is_latest: record.is_latest,
  ts: record.ts,
  record: { record_hash: record.record_hash, app_id: record.app_id },
  redacted: true,
});

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
  /** When the REPORT was generated: the claim's date, copied from the stored report. */
  generated_at: z.string().min(1),
  /**
   * When these RECORDS were read, which is download time - the bundle re-reads them rather than
   * freezing them (lib/report-generate.ts). The two dates differ, and an auditor comparing a
   * bundle with the report it came from needs to know which is which. Optional so a bundle
   * written before this field existed still parses.
   */
  collected_at: z.string().min(1).optional(),
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
  /** The stored report's own timestamp: when the CLAIM was made. */
  generatedAt: string;
  /** When the records below were read out of the database. */
  collectedAt: string;
  advertiser: ReportAdvertiser;
  period: ReportPeriod;
  report: ReportDocument;
  records: readonly BundleRecord[];
  supportingRecords: readonly SupportingRecord[];
  creatives: readonly BundleCreative[];
  publicKeys: Readonly<Record<string, string>>;
}

/** One chain order, so two bundles of the same data are byte-identical. */
const sorted = (records: readonly BundleRecord[]): BundleRecord[] =>
  [...records].sort(
    (a, b) =>
      a.app_id.localeCompare(b.app_id) ||
      a.seq - b.seq ||
      a.record_hash.localeCompare(b.record_hash),
  );

/** Sorted and de-duplicated. */
const uniqueRecords = (records: readonly BundleRecord[]): BundleRecord[] => {
  const byHash = new Map<string, BundleRecord>();
  for (const record of records) {
    byHash.set(record.record_hash, record);
  }
  return sorted([...byHash.values()]);
};

/**
 * The supporting set: reported records are never repeated, and a row that is only somebody's
 * positional predecessor is reduced to a chain reference. A row that is BOTH (a predecessor of
 * one record and the superseded version of another) keeps its document - it is a version of a
 * record that is in this report either way.
 */
const supportingEntries = (
  records: readonly SupportingRecord[],
  reported: ReadonlySet<string>,
): BundleRecord[] => {
  const byHash = new Map<string, { entry: SupportingRecord; full: boolean }>();
  for (const entry of records) {
    if (reported.has(entry.record_hash)) {
      continue;
    }
    const existing = byHash.get(entry.record_hash);
    byHash.set(entry.record_hash, {
      entry,
      full: entry.role === 'superseded' || (existing?.full ?? false),
    });
  }
  return sorted(
    [...byHash.values()].map(({ entry, full }) => {
      const record: BundleRecord = {
        audit_id: entry.audit_id,
        app_id: entry.app_id,
        seq: entry.seq,
        record_hash: entry.record_hash,
        is_latest: entry.is_latest,
        ts: entry.ts,
        record: entry.record,
      };
      return full ? record : chainReference(record);
    }),
  );
};

export const buildReportBundle = (input: ReportBundleInput): ReportBundle => {
  const reported = new Set(input.records.map((record) => record.record_hash));
  return {
    bundle_version: BUNDLE_VERSION,
    generated_at: input.generatedAt,
    collected_at: input.collectedAt,
    report_id: input.reportId,
    advertiser: input.advertiser,
    period: input.period,
    report: input.report,
    records: uniqueRecords(input.records),
    supporting_records: supportingEntries(input.supportingRecords, reported),
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

/**
 * The app's record at seq - 1, or null at the start of a chain or when it is not in the bundle.
 * For a supporting entry that is a chain reference this is { record_hash, app_id }, which is
 * exactly what core's checkChain compares prev_hash against.
 */
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
