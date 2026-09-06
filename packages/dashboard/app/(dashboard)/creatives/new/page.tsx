import { CATEGORIES_TAXONOMY } from '@adgate/schemas';

import { CreativeForm } from '@/components/creative-form';
import { PageHeader } from '@/components/page-header';
import { EMPTY_CREATIVE_VALUES } from '@/lib/creative-issue';
import { listAdvertiserOptions, listAppOptions } from '@/lib/creative-queries';

/**
 * Add one creative. The advertiser list and the app list are loaded here and handed to the form
 * as plain data: the form is a client component and must not reach the database or the schemas.
 * The same lists are loaded again inside the server action, because a form is a request and the
 * catalog may have changed since this page was rendered.
 */

export const dynamic = 'force-dynamic';

const NewCreativePage = async () => {
  const [advertisers, apps] = await Promise.all([listAdvertiserOptions(), listAppOptions()]);

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
        categories={CATEGORIES_TAXONOMY}
      />
    </section>
  );
};

export default NewCreativePage;
