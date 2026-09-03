import type { Clock } from '@adgate/core';
import { and, eq } from 'drizzle-orm';

import type { DbOrTx } from '../db/client.js';
import { advertisers, apps } from '../db/tables/apps.js';
import { auditRecords } from '../db/tables/audit.js';
import { creatives } from '../db/tables/catalog.js';
import { createEventStore } from '../events/store.js';
import type { PolicySource } from '../evaluate/policy-loader.js';
import type { ClickCreative } from './destination.js';

/**
 * What the click redirect reads and writes: the latest version of an audit id joined with the
 * served creative, its advertiser and the app's affiliate config and policy source (one query),
 * and the click event, inserted through the events store so a click from the redirect and one
 * reported by the SDK are the same row shape.
 */
export interface ClickTarget {
  /** The app whose record it is: the click event is attributed to it, not to any caller. */
  appId: string;
  app: PolicySource & { affiliateConfig: unknown };
  /** Null when the record served nothing (suppress) or the creatives row is gone. */
  creative: ClickCreative | null;
}

export interface ClickInsert {
  auditId: string;
  appId: string;
  ts: Date;
}

export interface ClickStore {
  findTarget(auditId: string): Promise<ClickTarget | null>;
  recordClick(click: ClickInsert): Promise<void>;
}

export interface ClickStoreOptions {
  now?: Clock | undefined;
}

export const createClickStore = (db: DbOrTx, options: ClickStoreOptions = {}): ClickStore => {
  const events = createEventStore(db, options);
  return {
    findTarget: async (auditId) => {
      const [row] = await db
        .select({
          appId: auditRecords.appId,
          app: {
            id: apps.id,
            policyYaml: apps.policyYaml,
            policyHash: apps.policyHash,
            affiliateConfig: apps.affiliateConfig,
          },
          creative: {
            source: creatives.source,
            urlTemplate: creatives.urlTemplate,
            network: creatives.network,
            programId: creatives.programId,
          },
          advertiserDomain: advertisers.domain,
        })
        .from(auditRecords)
        .innerJoin(apps, eq(auditRecords.appId, apps.id))
        .leftJoin(creatives, eq(auditRecords.creativeId, creatives.id))
        .leftJoin(advertisers, eq(creatives.advertiserId, advertisers.id))
        .where(and(eq(auditRecords.id, auditId), eq(auditRecords.isLatest, true)))
        .limit(1);
      if (row === undefined) {
        return null;
      }
      const creative =
        row.creative === null || row.advertiserDomain === null
          ? null
          : { ...row.creative, advertiserDomain: row.advertiserDomain };
      return { appId: row.appId, app: row.app, creative };
    },
    recordClick: async (click) => {
      await events.insert({
        auditId: click.auditId,
        appId: click.appId,
        type: 'click',
        ts: click.ts,
        meta: {},
      });
    },
  };
};
