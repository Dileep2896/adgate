import { CATEGORIES_TAXONOMY } from '@adgateio/schemas';
import Link from 'next/link';

import { CreativeForm } from '@/components/creative-form';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/auth';
import { EMPTY_CREATIVE_VALUES } from '@/lib/creative-issue';
import { listAdvertiserOptions, listAppOptions } from '@/lib/creative-queries';

/**
 * Add one creative. The advertiser list and the app list are loaded here and handed to the form
 * as plain data: the form is a client component and must not reach the database or the schemas.
 * The same lists are loaded again inside the server action, because a form is a request and the
 * catalog may have changed since this page was rendered.
 *
 * A member's creative always belongs to one of their own apps, so with no apps there is nothing
 * to attach one to and the form would be a dead end: they get the step they actually need first.
 */

export const dynamic = 'force-dynamic';

const NewCreativePage = async () => {
  const session = await requireSession('/creatives/new');
  const [advertisers, apps] = await Promise.all([
    listAdvertiserOptions(),
    listAppOptions(session.scope),
  ]);
  const admin = session.role === 'admin';

  if (!admin && apps.length === 0) {
    return (
      <section>
        <PageHeader title="New creative" back={{ href: '/creatives', label: 'All creatives' }} />
        <EmptyState
          title="Create an app first."
          testId="no-apps-for-creative"
          actions={
            <Link href="/apps/new" className="ag-btn ag-btn-primary">
              New app
            </Link>
          }
        >
          A creative belongs to one app&apos;s private catalog: that is what decides which
          conversations it can appear in. The shared catalog above it is inventory the operator of
          this gateway maintains, and it is read only here.
        </EmptyState>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title="New creative"
        back={{ href: '/creatives', label: 'All creatives' }}
        lede="Eligible as soon as it is saved: the gateway loads the catalog on every evaluation."
      />
      <CreativeForm
        mode="create"
        values={EMPTY_CREATIVE_VALUES}
        advertisers={advertisers}
        apps={apps}
        allowGlobalCatalog={admin}
        categories={CATEGORIES_TAXONOMY}
      />
    </section>
  );
};

export default NewCreativePage;
