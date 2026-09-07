import {
  createCreative,
  type Db,
  setCreativeActive,
  updateCreative,
} from '@adgateio/gateway/admin';

import type { CreativeWriter } from './creative-save';

/**
 * The Postgres side of the creative editor. Every write here is the GATEWAY's own function
 * (`@adgateio/gateway/admin` -> catalog/creative-admin.ts), not SQL of the dashboard's: the
 * advertiser rule, the content_hash and the row shape are decided in one place, next to the
 * `seed-creatives` importer that writes the same table.
 *
 * It needs a READ-WRITE handle (lib/db-write.ts). The default handle from lib/db.ts is opened
 * read only and would fail at Postgres, which is the intended behaviour.
 */

export const createCreativeWriter = (db: Db): CreativeWriter => ({
  create: (value) => createCreative(db, { seed: value.seed, appId: value.appId }),
  update: (id, value) => updateCreative(db, id, { seed: value.seed, appId: value.appId }),
});

/**
 * Pauses or resumes one creative; returns false when the id is unknown. Never a delete: audit
 * records reference the row and verification recomputes its content hash from it.
 */
export const setCreativeActiveById = async (
  db: Db,
  id: string,
  active: boolean,
): Promise<boolean> => (await setCreativeActive(db, id, active)) !== null;
