'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { type CreativeSaveState } from '@/lib/action-state';
import { readText } from '@/lib/app-form';
import { requireSession } from '@/lib/auth';
import { readCreativeFormValues } from '@/lib/creative-form';
import type { CreativeFieldIssue } from '@/lib/creative-issue';
import { getCreative, listAdvertiserOptions, listAppOptions } from '@/lib/creative-queries';
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
  const session = await requireSession();
  const [advertisers, apps] = await Promise.all([
    listAdvertiserOptions(),
    listAppOptions(session.scope),
  ]);

  /** Every refusal hands the typed values back, or React 19's form reset would erase them. */
  const refused = (issues: CreativeFieldIssue[]): CreativeSaveState => ({
    status: 'invalid',
    attempt: previous.status === 'invalid' ? previous.attempt + 1 : 1,
    values: readCreativeFormValues(formData),
    issues,
  });

  // Editing names a creative id in the request, so the row has to be one this account can read
  // before it can be one this account rewrites. `apps` is already scoped, which is what stops a
  // creative being attached to somebody else's app.
  const editing = readText(formData, 'id').trim();
  if (editing !== '' && (await getCreative(session.scope, editing)) === null) {
    return refused([{ field: 'form', message: 'That creative no longer exists.' }]);
  }

  let result;
  try {
    result = await saveCreative(createCreativeWriter(writeDb()), formData, {
      advertisers,
      appIds: apps.map((app) => app.id),
      allowGlobalCatalog: session.role === 'admin',
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
  const session = await requireSession();
  const id = readText(formData, 'id').trim();
  const active = readText(formData, 'active') === 'true';
  if (id === '') {
    return;
  }
  // A pause button is a POST with a creative id in it. The row must be one this account can see,
  // and it must not be shared inventory: pausing a global creative would stop it for every app
  // on the gateway, which is the operator's decision and nobody else's.
  const creative = await getCreative(session.scope, id);
  if (creative === null || (creative.appId === null && session.role !== 'admin')) {
    return;
  }
  await setCreativeActiveById(writeDb(), id, active);
  revalidatePath('/creatives');
  revalidatePath(`/creatives/${id}`);
};
