'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { type CreativeSaveState } from '@/lib/action-state';
import { readText } from '@/lib/app-form';
import { requireSession } from '@/lib/auth';
import { readCreativeFormValues } from '@/lib/creative-form';
import type { CreativeFieldIssue } from '@/lib/creative-issue';
import { listAdvertiserOptions, listAppOptions } from '@/lib/creative-queries';
import { CREATIVE_WRITE_FAILED_MESSAGE, saveCreative } from '@/lib/creative-save';
import { createCreativeWriter, setCreativeActiveById } from '@/lib/creative-store';
import { dashboardWriteDb } from '@/lib/db-write';
import { dashboardEnv } from '@/lib/env';

/**
 * The catalog writes. Like app/(dashboard)/apps/actions.ts these use the dashboard's only
 * read-write handle (lib/db-write.ts) and the gateway's own write functions; every other page
 * reads through the read-only one.
 *
 * A server action is a POST to the page's own URL and does NOT render the layout, so
 * requireSession() in app/(dashboard)/layout.tsx does not protect it: both actions call
 * requireSession() themselves.
 *
 * Nothing is ever deleted here. Deactivating flips creatives.active; the row stays because
 * audit records name it and verification recomputes its content_hash from it.
 */

const writeDb = () => dashboardWriteDb(dashboardEnv().databaseUrl);

/**
 * Validates the form against the catalog it is being written into and, only then, inserts or
 * updates one creative. An invalid field writes nothing (lib/creative-save.ts) and comes back
 * attached to the input that caused it. On success the browser lands on the creative's page,
 * which shows the content_hash that was just recomputed.
 */
export const saveCreativeAction = async (
  previous: CreativeSaveState,
  formData: FormData,
): Promise<CreativeSaveState> => {
  await requireSession();
  const [advertisers, apps] = await Promise.all([listAdvertiserOptions(), listAppOptions()]);

  /** Every refusal hands the typed values back, or React 19's form reset would erase them. */
  const refused = (issues: CreativeFieldIssue[]): CreativeSaveState => ({
    status: 'invalid',
    attempt: previous.status === 'invalid' ? previous.attempt + 1 : 1,
    values: readCreativeFormValues(formData),
    issues,
  });

  let result;
  try {
    result = await saveCreative(createCreativeWriter(writeDb()), formData, {
      advertisers,
      appIds: apps.map((app) => app.id),
    });
  } catch {
    return refused([{ field: 'form', message: CREATIVE_WRITE_FAILED_MESSAGE }]);
  }
  if (!result.ok) {
    return refused(result.issues);
  }

  revalidatePath('/creatives');
  revalidatePath(`/creatives/${result.id}`);
  redirect(`/creatives/${result.id}?saved=${result.created ? 'created' : 'updated'}`);
};

/**
 * Pauses or resumes one creative. Idempotent, and an unknown id is a no-op: the button is on a
 * page that was rendered from the same table, so the only way to miss is a row someone removed
 * in SQL in the meantime.
 */
export const setCreativeActiveAction = async (formData: FormData): Promise<void> => {
  await requireSession();
  const id = readText(formData, 'id').trim();
  const active = readText(formData, 'active') === 'true';
  if (id === '') {
    return;
  }
  await setCreativeActiveById(writeDb(), id, active);
  revalidatePath('/creatives');
  revalidatePath(`/creatives/${id}`);
};
