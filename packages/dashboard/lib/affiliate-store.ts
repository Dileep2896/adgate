import { type Db, setAffiliateConfig } from '@adgate/gateway/admin';
import type { AffiliateConfig } from '@adgate/schemas';

import type { AffiliateWriter } from './affiliate-save';

/**
 * The Postgres side of the affiliate form. The write is the GATEWAY's own setAffiliateConfig
 * (`@adgate/gateway/admin`), not SQL of the dashboard's, so the column the request path reads is
 * written by the module that owns its meaning - the same rule lib/creative-store.ts follows.
 *
 * It needs a READ-WRITE handle (lib/db-write.ts). The default handle from lib/db.ts is opened
 * read only and would fail at Postgres, which is the intended behaviour.
 */
export const createAffiliateWriter = (db: Db): AffiliateWriter => ({
  save: async (appId: string, config: AffiliateConfig) => {
    const result = await setAffiliateConfig(db, appId, config);
    return result.ok ? { ok: true, issues: [] } : { ok: false, issues: result.issues };
  },
});
