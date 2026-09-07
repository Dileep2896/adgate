import type { CreativeWriteFailure, CreativeWriteResult } from '@adgateio/gateway/admin';

import type { FormFields } from './app-form';
import {
  type CreativeFormContext,
  type CreativeFormValue,
  parseCreativeForm,
} from './creative-form';
import type { CreativeFieldIssue } from './creative-issue';

/**
 * Saving a creative: validate, then write, in that order and never the other way round - the
 * same shape as lib/policy-save.ts. The write is a port (CreativeWriter) so "a form with a bad
 * field writes NOTHING" is provable without a database, and the Postgres implementation
 * (lib/creative-store.ts) is the gateway's own createCreative / updateCreative.
 *
 * The gateway refuses two things the form cannot see on its own - a domain being renamed and a
 * headline already taken in this catalog - because both are races against another operator or
 * a `seed-creatives` run. Those come back as failures, and issueForFailure() puts each one on
 * the field it belongs to.
 */

export interface CreativeWriter {
  create(value: CreativeFormValue): Promise<CreativeWriteResult>;
  update(id: string, value: CreativeFormValue): Promise<CreativeWriteResult>;
}

export type SaveCreativeResult =
  | { ok: true; id: string; contentHash: string; created: boolean }
  | { ok: false; issues: CreativeFieldIssue[] };

/** What a form says when the database, not the operator, refused the write. */
export const CREATIVE_WRITE_FAILED_MESSAGE =
  'The gateway database rejected that write. Nothing was changed. Check the dashboard logs.';

export const issueForFailure = (failure: CreativeWriteFailure): CreativeFieldIssue => {
  switch (failure.error) {
    case 'advertiser_name_conflict':
      return {
        field: 'advertiser_domain',
        message: `${failure.domain} is already registered as “${failure.name}”. Choose that advertiser, or use a different domain: one name per domain.`,
      };
    case 'duplicate_headline':
      return {
        field: 'headline',
        message: `This advertiser already has a creative with that headline in this catalog (${failure.creativeId}). Edit that one, or give this one a different headline.`,
      };
    case 'app_not_found':
      return { field: 'app_id', message: 'That app is not registered against this gateway.' };
    case 'creative_not_found':
      return { field: 'form', message: 'That creative no longer exists.' };
  }
};

/**
 * Parses the form against the catalog it is being written into and, only if every field is
 * valid, writes it. On any problem the writer is never called, so the stored row - and the
 * content_hash the audit records reference - is exactly what it was.
 */
export const saveCreative = async (
  writer: CreativeWriter,
  form: FormFields,
  context: CreativeFormContext,
): Promise<SaveCreativeResult> => {
  const parsed = parseCreativeForm(form, context);
  if (!parsed.ok) {
    return { ok: false, issues: parsed.issues };
  }
  const { id } = parsed.value;
  const result =
    id === null ? await writer.create(parsed.value) : await writer.update(id, parsed.value);
  if (!result.ok) {
    return { ok: false, issues: [issueForFailure(result)] };
  }
  return {
    ok: true,
    id: result.creative.id,
    contentHash: result.creative.contentHash,
    created: id === null,
  };
};
