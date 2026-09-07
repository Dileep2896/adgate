import type { Db } from '@adgateio/gateway/admin';
import { apps } from '@adgateio/gateway/schema';
import { eq, sql } from 'drizzle-orm';

import type { PolicyWriter } from './policy-save';

/**
 * The Postgres side of the admin actions that the gateway does not already own.
 *
 * Creating an app and issuing or revoking a key are the gateway's own functions
 * (`@adgateio/gateway/admin`); the one write that has no counterpart there is replacing an app's
 * stored policy, so it lives here behind the PolicyWriter port that savePolicy() talks to.
 *
 * It needs a READ-WRITE handle (lib/db-write.ts). Passing the read-only one from lib/db.ts
 * fails at Postgres, which is the intended behaviour.
 */

/**
 * Stores the document and its hash and bumps policy_version by one. The bump is computed by
 * Postgres (`policy_version + 1`), not read-then-written in the app, so two operators saving
 * at the same time cannot land on the same version. Returns null when the app is gone.
 */
export const createPolicyWriter = (db: Db): PolicyWriter => ({
  update: async ({ appId, policyYaml, policyHash }) => {
    const [row] = await db
      .update(apps)
      .set({
        policyYaml,
        policyHash,
        policyVersion: sql`${apps.policyVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(apps.id, appId))
      .returning({ policyVersion: apps.policyVersion, policyHash: apps.policyHash });
    return row ?? null;
  },
});
