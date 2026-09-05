import { CATEGORIES_TAXONOMY } from '@adgate/schemas';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CopyButton } from '@/components/copy-button';
import { CreativeActiveToggle } from '@/components/creative-active-toggle';
import { CreativeForm } from '@/components/creative-form';
import {
  creativeFormValues,
  getCreative,
  listAdvertiserOptions,
  listAppOptions,
} from '@/lib/creative-queries';
import { formatTimestamp } from '@/lib/format';

/**
 * One creative: its stored content_hash, whether it is running, and the editor.
 *
 * The hash shown here is the one the demand path stamped into every audit record that served
 * this creative. Saving a change to the copy or the destination recomputes it, which is exactly
 * why the form says so: older records keep the old hash and will report a creative_hash
 * mismatch when they are verified.
 */

export const dynamic = 'force-dynamic';

const SAVED_MESSAGE: Record<string, string> = {
  created: 'Creative created. It is eligible for the next evaluation.',
  updated: 'Creative saved. Its content_hash below is the one new audit records will carry.',
};

const CreativePage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const creative = await getCreative(id);
  if (creative === null) {
    notFound();
  }
  const [advertisers, apps] = await Promise.all([listAdvertiserOptions(), listAppOptions()]);
  const saved = typeof query['saved'] === 'string' ? SAVED_MESSAGE[query['saved']] : undefined;

  return (
    <section className="space-y-6">
      <div>
        <Link
          href="/creatives"
          className="text-sm text-stone-500 underline-offset-2 hover:underline"
        >
          &larr; Creatives
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{creative.headline}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
          <span data-testid="creative-id" className="font-mono text-xs">
            {creative.id}
          </span>
          <span className="text-xs">
            {creative.advertiser} ({creative.advertiserDomain})
          </span>
          <span className="text-xs">updated {formatTimestamp(creative.updatedAt)}</span>
          <span data-testid="creative-state" className="text-xs font-medium">
            {creative.active ? 'active' : 'paused'}
          </span>
        </p>
      </div>

      {saved === undefined ? null : (
        <p
          data-testid="creative-saved"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {saved}
        </p>
      )}

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <span className="font-semibold text-stone-700">content_hash</span>
          <code data-testid="creative-content-hash" className="font-mono break-all text-stone-700">
            {creative.contentHash}
          </code>
          <CopyButton value={creative.contentHash} label="Copy hash" />
        </p>
        <CreativeActiveToggle id={creative.id} active={creative.active} />
      </div>

      <CreativeForm
        mode="edit"
        values={creativeFormValues(creative)}
        advertisers={advertisers}
        apps={apps}
        categories={CATEGORIES_TAXONOMY}
      />
    </section>
  );
};

export default CreativePage;
