import { CATEGORIES_TAXONOMY } from '@adgate/schemas';
import Link from 'next/link';

import { CreativeForm } from '@/components/creative-form';
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
      <Link href="/creatives" className="text-sm text-stone-500 underline-offset-2 hover:underline">
        &larr; Creatives
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">New creative</h1>
      <p className="mt-1 mb-6 text-sm text-stone-500">
        Eligible as soon as it is saved: the gateway loads the catalog on every evaluation.
      </p>
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
