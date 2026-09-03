import type { Clock } from '@adgate/core';
import { AuditId, type PolicyConfig } from '@adgate/schemas';
import type { Context } from 'hono';
import type { Logger } from 'pino';

import type { AppEnv } from '../app-env.js';
import { errorResponse } from '../http-error.js';
import type { PolicyLoader, PolicySource } from '../evaluate/policy-loader.js';
import { resolveDestination } from './destination.js';
import type { ClickStore } from './store.js';

/**
 * GET /c/:audit_id (docs/api.md): the click redirect every creative.url points at. Public: the
 * audit id is the capability (an unguessable ULID the app received), so no API key is read.
 * Loads the latest version of the record, refuses with 404 not_found when there is none, when
 * it served nothing, or when the destination is not an absolute http(s) URL (never a
 * javascript: or data: redirect), writes the click event attributed to the record's app, and
 * answers 302 with Cache-Control: no-store (a cached redirect would skip the event) and
 * Referrer-Policy: no-referrer (the gateway URL carries the audit id). If the event cannot be
 * written the redirect does not happen: the click log is what the audit trail is for.
 */
export const NOT_FOUND_MESSAGE = 'audit record not found or has no creative';

export interface ClickDeps {
  store: ClickStore;
  policies: PolicyLoader;
  /** Milliseconds clock for the event timestamp. */
  now: Clock;
}

/** The app's policy for the affiliate network; a policy that no longer parses is null (landing page). */
const policyOf = (policies: PolicyLoader, app: PolicySource, log: Logger): PolicyConfig | null => {
  try {
    return policies.load(app);
  } catch (error) {
    log.warn(
      { app_id: app.id, error_name: error instanceof Error ? error.name : 'NonError' },
      'click: stored policy unreadable; affiliate network unknown',
    );
    return null;
  }
};

export const clickRoute =
  (deps: ClickDeps) =>
  async (c: Context<AppEnv>): Promise<Response> => {
    const log = c.get('logger');
    const auditId = c.req.param('audit_id') ?? '';
    const notFound = (why: string): Response => {
      log.info({ status: 404, audit_id: auditId, why }, 'click rejected');
      return errorResponse(c, 404, 'not_found', NOT_FOUND_MESSAGE);
    };
    if (!AuditId.safeParse(auditId).success) {
      return notFound('malformed id');
    }
    const target = await deps.store.findTarget(auditId);
    if (target === null) {
      return notFound('unknown id');
    }
    if (target.creative === null) {
      return notFound('no creative');
    }
    const destination = resolveDestination({
      creative: target.creative,
      affiliateConfig: target.app.affiliateConfig,
      policy: policyOf(deps.policies, target.app, log),
    });
    if (!destination.ok) {
      log.warn({ audit_id: auditId, app_id: target.appId }, 'click: destination is not http(s)');
      return notFound(destination.reason);
    }
    await deps.store.recordClick({ auditId, appId: target.appId, ts: new Date(deps.now()) });
    log.info(
      {
        audit_id: auditId,
        app_id: target.appId,
        source: target.creative.source,
        via: destination.via,
      },
      'click',
    );
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    return c.redirect(destination.url, 302);
  };
