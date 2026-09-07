import type { AffiliateConfig } from '@adgate/schemas';

import type { FormFields } from './app-form';
import { parseAffiliateForm } from './affiliate-form';
import { AFFILIATE_WRITE_FAILED_MESSAGE, type AffiliateFieldIssue } from './affiliate-issue';

/**
 * Saving an affiliate configuration: validate, then write, in that order and never the other way
 * round - the same shape as lib/policy-save.ts and lib/creative-save.ts. The write is a PORT, so
 * "a form with a bad field writes NOTHING" is provable without a database; lib/affiliate-store.ts
 * is the Postgres implementation and calls the gateway's own setAffiliateConfig.
 */

export interface AffiliateWriter {
  save(appId: string, config: AffiliateConfig): Promise<{ ok: boolean; issues: string[] }>;
}

export type SaveAffiliateResult =
  { ok: true; config: AffiliateConfig } | { ok: false; issues: AffiliateFieldIssue[] };

export const saveAffiliateConfig = async (
  writer: AffiliateWriter,
  appId: string,
  form: FormFields,
): Promise<SaveAffiliateResult> => {
  const parsed = parseAffiliateForm(form);
  if (!parsed.ok) {
    return parsed;
  }
  const written = await writer.save(appId, parsed.config);
  if (!written.ok) {
    // The gateway refused it (an app that is gone, or a schema this module has not been taught
    // about). Its issues never carry the values, so they are safe to show.
    return {
      ok: false,
      issues:
        written.issues.length === 0
          ? [{ field: 'form', message: AFFILIATE_WRITE_FAILED_MESSAGE }]
          : written.issues.map((message) => ({ field: 'form' as const, message })),
    };
  }
  return { ok: true, config: parsed.config };
};
