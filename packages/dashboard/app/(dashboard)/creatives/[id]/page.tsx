import { CATEGORIES_TAXONOMY } from '@adgateio/schemas';
import { notFound } from 'next/navigation';

import { CopyButton } from '@/components/copy-button';
import { CreativeActiveToggle } from '@/components/creative-active-toggle';
import { CreativeForm } from '@/components/creative-form';
import { DeliveryBreakdown } from '@/components/delivery-breakdown';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/auth';
import {
  creativeFormValues,
  getCreative,
  listAdvertiserOptions,
  listAppOptions,
} from '@/lib/creative-queries';
import { creativeDelivery, deliveryOf } from '@/lib/deliverability';
import { formatTimestamp } from '@/lib/format';

/**
 * One creative: its stored content_hash, whether it can actually serve, and the editor.
 *
 * The hash shown here is the one the demand path stamped into every audit record that served
 * this creative. Saving a change to the copy or the destination recomputes it, which is exactly
 * why the form says so: older records keep the old hash and will report a creative_hash
 * mismatch when they are verified.
 *
 * DELIVERY IS PER APP, which is why it is a table and not a badge. `active` says somebody has not
 * paused it; whether it can serve is decided against ONE app's policy and ONE app's affiliate
 * accounts, so a creative in the shared catalog gets one verdict per app the session can see and
 * can honestly be blocked for one of them and fine for another. lib/deliverability.ts runs the
 * gateway's own diagnostic here on the server and hands the component plain rows.
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
  const session = await requireSession(`/creatives/${id}`);
  const creative = await getCreative(session.scope, id);
  if (creative === null) {
    notFound();
  }
  const [advertisers, apps, delivery] = await Promise.all([
    listAdvertiserOptions(),
    listAppOptions(session.scope),
    creativeDelivery(session.scope, [creative]),
  ]);
  const saved = typeof query['saved'] === 'string' ? SAVED_MESSAGE[query['saved']] : undefined;
  const admin = session.role === 'admin';
  // Shared inventory is the operator's. A member may read it - it is what their apps serve - but
  // editing or pausing it would change what every other app on this gateway shows.
  const writable = admin || creative.appId !== null;

  return (
    <section className="space-y-6">
      <PageHeader
        title={creative.headline}
        back={{ href: '/creatives', label: 'All creatives' }}
        actions={
          writable ? <CreativeActiveToggle id={creative.id} active={creative.active} /> : undefined
        }
        meta={
          <>
            <span data-testid="creative-id" className="ag-mono-2xs">
              {creative.id}
            </span>
            <span>
              {creative.advertiser} ({creative.advertiserDomain})
            </span>
            <span>updated {formatTimestamp(creative.updatedAt)}</span>
            <span
              data-testid="creative-state"
              className={creative.active ? 'ag-badge ag-badge-ok' : 'ag-badge'}
            >
              {creative.active ? 'active' : 'paused'}
            </span>
          </>
        }
      />

      {saved === undefined ? null : (
        <p data-testid="creative-saved" className="ag-note ag-note-ok">
          {saved}
        </p>
      )}

      <div className="card">
        <div className="ag-section-head">
          <h2 className="ag-section-title">content_hash</h2>
          <p className="ag-section-hint">
            The value every audit record that served this creative carries.
          </p>
        </div>
        <p className="flex flex-wrap items-center gap-2">
          <code data-testid="creative-content-hash" className="ag-mono-2xs break-all">
            {creative.contentHash}
          </code>
          <CopyButton value={creative.contentHash} label="Copy hash" />
        </p>
      </div>

      <DeliveryBreakdown
        delivery={deliveryOf(delivery, creative.id)}
        active={creative.active}
        shared={creative.appId === null}
      />

      {writable ? (
        <CreativeForm
          mode="edit"
          values={creativeFormValues(creative)}
          advertisers={advertisers}
          apps={apps}
          allowGlobalCatalog={admin}
          categories={CATEGORIES_TAXONOMY}
        />
      ) : (
        <p data-testid="creative-read-only" className="ag-note">
          This creative is in the shared catalog: every app on this gateway may serve it, and the
          operator maintains it. Yours live in your own app&apos;s catalog, where editing one
          changes nothing for anybody else.
        </p>
      )}
    </section>
  );
};

export default CreativePage;
