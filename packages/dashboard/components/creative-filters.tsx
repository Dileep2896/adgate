import Link from 'next/link';

import { type AppOption, CREATIVE_SOURCE_VALUES } from '@/lib/creative-issue';
import { ALL_FILTER, type CreativeFilters, GLOBAL_SCOPE } from '@/lib/creative-queries';

/**
 * The catalog filters: source, active flag and which catalog a creative is in. A plain GET form
 * whose fields become the page's query string - no client component, no JavaScript, and the
 * filtered view is a URL an operator can bookmark or paste into a ticket.
 */

const SELECT =
  'rounded-md border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-stone-900';

export interface CreativeFiltersFormProps {
  filters: CreativeFilters;
  apps: readonly AppOption[];
}

export const CreativeFiltersForm = ({ filters, apps }: CreativeFiltersFormProps) => (
  <form method="get" action="/creatives" className="card flex flex-wrap items-end gap-4">
    <div>
      <label htmlFor="source" className="block text-xs font-medium text-stone-500 uppercase">
        Source
      </label>
      <select id="source" name="source" defaultValue={filters.source} className={`mt-1 ${SELECT}`}>
        <option value={ALL_FILTER}>All sources</option>
        {CREATIVE_SOURCE_VALUES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor="active" className="block text-xs font-medium text-stone-500 uppercase">
        Status
      </label>
      <select id="active" name="active" defaultValue={filters.active} className={`mt-1 ${SELECT}`}>
        <option value={ALL_FILTER}>Active and paused</option>
        <option value="active">Active only</option>
        <option value="inactive">Paused only</option>
      </select>
    </div>

    <div>
      <label htmlFor="scope" className="block text-xs font-medium text-stone-500 uppercase">
        Catalog
      </label>
      <select id="scope" name="scope" defaultValue={filters.scope} className={`mt-1 ${SELECT}`}>
        <option value={ALL_FILTER}>Every catalog</option>
        <option value={GLOBAL_SCOPE}>Global only</option>
        {apps.map((app) => (
          <option key={app.id} value={app.id}>
            {app.name}
          </option>
        ))}
      </select>
    </div>

    <button
      type="submit"
      data-testid="apply-filters"
      className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
    >
      Filter
    </button>
    <Link
      href="/creatives"
      className="pb-2 text-sm text-stone-600 underline-offset-2 hover:underline"
    >
      Clear
    </Link>
  </form>
);
