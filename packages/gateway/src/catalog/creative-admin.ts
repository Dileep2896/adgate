import { creativeId, prefixedUlid, type UlidOptions } from '@adgateio/core';
import type { SeedCreative } from '@adgateio/schemas';
import { and, eq, isNull, ne } from 'drizzle-orm';

import type { Db, DbOrTx } from '../db/client.js';
import { advertisers, apps } from '../db/tables/apps.js';
import { creatives } from '../db/tables/catalog.js';
import { ADVERTISER_ID_PREFIX, type CreativeRow, creativeValues } from './seed.js';

/**
 * Editing the catalog one creative at a time: what the dashboard's /creatives pages do, next to
 * the bulk `seed-creatives` importer that owns the same tables (seed.ts).
 *
 * It writes through seed.ts's own creativeValues(), so a creative an operator types in is the
 * row the seed file would have produced, content_hash included - the demand adapters and the
 * `creative_hash` verification check cannot tell the two apart.
 *
 * THREE RULES, ENFORCED HERE AND NOT ONLY IN A FORM:
 *  1. One name per domain. advertisers.domain is unique and its name is part of every one of its
 *     creatives' content_hash, so a second name for a known domain is refused rather than
 *     renaming the advertiser under records that already reference the old hash.
 *  2. One (advertiser, headline) per catalog, because that pair is the seeder's upsert key: a
 *     duplicate would make the next `seed-creatives` run overwrite an operator's creative.
 *  3. Nothing is ever deleted. Deactivating sets active = false; audit records reference the row
 *     forever and verification recomputes its content hash.
 *
 * Failures are returned, not thrown: every one of them is something an operator typed, and the
 * dashboard renders them next to the field. A rejected write leaves the tables untouched.
 */

export interface CreativeWrite {
  /** The creative exactly as the catalog schema describes it, minus the id. */
  seed: SeedCreative;
  /** Null = the global catalog every app may serve; an app id = that app's private catalog. */
  appId: string | null;
  ulid?: UlidOptions | undefined;
}

export type CreativeWriteFailure =
  /** `domain` is already registered under `name`; the write would have renamed it. */
  | { ok: false; error: 'advertiser_name_conflict'; domain: string; name: string }
  /** This catalog already has a creative with that headline for that advertiser. */
  | { ok: false; error: 'duplicate_headline'; headline: string; creativeId: string }
  | { ok: false; error: 'app_not_found'; appId: string }
  | { ok: false; error: 'creative_not_found'; creativeId: string };

export type CreativeWriteResult = { ok: true; creative: CreativeRow } | CreativeWriteFailure;

/** The catalog a creative belongs to: the global one (null) or one app's private one. */
const catalogScope = (appId: string | null) =>
  appId === null ? isNull(creatives.appId) : eq(creatives.appId, appId);

const appExists = async (tx: DbOrTx, appId: string): Promise<boolean> => {
  const [row] = await tx.select({ id: apps.id }).from(apps).where(eq(apps.id, appId));
  return row !== undefined;
};

type AdvertiserLookup =
  | { ok: true; id: string | null; name: string; domain: string }
  | { ok: false; error: 'advertiser_name_conflict'; domain: string; name: string };

/**
 * The advertisers row for this creative's name and domain, WITHOUT writing: null id means it
 * does not exist yet and insertAdvertiser() must mint one. Domains are the identity, so a known
 * domain under a different name is rule 1 above.
 */
const findAdvertiser = async (tx: DbOrTx, seed: SeedCreative): Promise<AdvertiserLookup> => {
  const [row] = await tx
    .select()
    .from(advertisers)
    .where(eq(advertisers.domain, seed.advertiser_domain));
  if (row === undefined) {
    return { ok: true, id: null, name: seed.advertiser, domain: seed.advertiser_domain };
  }
  if (row.name !== seed.advertiser) {
    return {
      ok: false,
      error: 'advertiser_name_conflict',
      domain: row.domain,
      name: row.name,
    };
  }
  return { ok: true, id: row.id, name: row.name, domain: row.domain };
};

const insertAdvertiser = async (
  tx: DbOrTx,
  seed: SeedCreative,
  ulid: UlidOptions | undefined,
): Promise<string> => {
  const id = prefixedUlid(ADVERTISER_ID_PREFIX, ulid);
  await tx
    .insert(advertisers)
    .values({ id, name: seed.advertiser, domain: seed.advertiser_domain });
  return id;
};

/** The id of the creative already holding (advertiser, headline) in this catalog, or null. */
const headlineOwner = async (
  tx: DbOrTx,
  advertiserId: string,
  headline: string,
  appId: string | null,
  exceptId: string | null,
): Promise<string | null> => {
  const [row] = await tx
    .select({ id: creatives.id })
    .from(creatives)
    .where(
      and(
        eq(creatives.advertiserId, advertiserId),
        eq(creatives.headline, headline),
        catalogScope(appId),
        ...(exceptId === null ? [] : [ne(creatives.id, exceptId)]),
      ),
    );
  return row?.id ?? null;
};

/**
 * Everything both writes check before touching a row: the app exists, the advertiser is not
 * being renamed and the headline is free. Returns the advertiser id to write against; the
 * advertiser is only INSERTED once every check has passed, so a rejected write writes nothing.
 */
const prepare = async (
  tx: DbOrTx,
  input: CreativeWrite,
  exceptId: string | null,
): Promise<{ ok: true; advertiserId: string } | CreativeWriteFailure> => {
  if (input.appId !== null && !(await appExists(tx, input.appId))) {
    return { ok: false, error: 'app_not_found', appId: input.appId };
  }
  const advertiser = await findAdvertiser(tx, input.seed);
  if (!advertiser.ok) {
    return advertiser;
  }
  if (advertiser.id !== null) {
    const owner = await headlineOwner(
      tx,
      advertiser.id,
      input.seed.headline,
      input.appId,
      exceptId,
    );
    if (owner !== null) {
      return {
        ok: false,
        error: 'duplicate_headline',
        headline: input.seed.headline,
        creativeId: owner,
      };
    }
  }
  const advertiserId = advertiser.id ?? (await insertAdvertiser(tx, input.seed, input.ulid));
  return { ok: true, advertiserId };
};

/** Inserts one creative (and its advertiser, when the domain is new) in one transaction. */
export const createCreative = async (db: Db, input: CreativeWrite): Promise<CreativeWriteResult> =>
  db.transaction(async (tx) => {
    const prepared = await prepare(tx, input, null);
    if (!prepared.ok) {
      return prepared;
    }
    const values = creativeValues(input.seed, prepared.advertiserId, input.appId);
    const [row] = await tx
      .insert(creatives)
      .values({ id: creativeId(input.ulid), ...values })
      .returning();
    if (row === undefined) {
      throw new Error('createCreative: insert returned no row');
    }
    return { ok: true, creative: row };
  });

/**
 * Replaces every column of one creative, content_hash included. Changing the copy or the
 * destination therefore changes content_hash: audit records written earlier keep the OLD hash
 * and their `creative_hash` check reports a mismatch, which is the point of storing it.
 */
export const updateCreative = async (
  db: Db,
  id: string,
  input: CreativeWrite,
): Promise<CreativeWriteResult> =>
  db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.id, id));
    if (existing === undefined) {
      return { ok: false, error: 'creative_not_found', creativeId: id };
    }
    const prepared = await prepare(tx, input, id);
    if (!prepared.ok) {
      return prepared;
    }
    const values = creativeValues(input.seed, prepared.advertiserId, input.appId);
    const [row] = await tx
      .update(creatives)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(creatives.id, id))
      .returning();
    if (row === undefined) {
      throw new Error('updateCreative: update returned no row');
    }
    return { ok: true, creative: row };
  });

/**
 * Pauses or resumes one creative. NEVER a delete: audit records name creative ids and
 * verification recomputes the content hash of the stored row, so the row has to outlive the
 * campaign. An inactive creative is skipped by every adapter (core matchScore).
 */
export const setCreativeActive = async (
  db: Db,
  id: string,
  active: boolean,
): Promise<CreativeRow | null> => {
  const [row] = await db
    .update(creatives)
    .set({ active, updatedAt: new Date() })
    .where(eq(creatives.id, id))
    .returning();
  return row ?? null;
};
