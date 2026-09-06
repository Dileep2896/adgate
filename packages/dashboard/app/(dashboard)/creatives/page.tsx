import Link from 'next/link';

import { CreativeActiveToggle } from '@/components/creative-active-toggle';
import { CreativeFiltersForm } from '@/components/creative-filters';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { formatAmount, truncateHash } from '@/lib/format';
import {
  ALL_FILTER,
  type CreativeFilters,
  type CreativeRecord,
  listAppOptions,
  listCreatives,
  parseCreativeFilters,
} from '@/lib/creative-queries';

/**
 * The catalog: every creative the gateway can serve, with everything the demand path actually
 * uses to choose one - who it belongs to, what it targets, what it pays, whether it is running
 * and which catalog it is in - plus the content_hash the audit records reference.
 *
 * Reads only (lib/creative-queries.ts). The two writes a row can start, editing it and pausing
 * it, are the server actions in ./actions.ts.
 *
 * ELEVEN COLUMNS, IN PRIORITY ORDER. Advertiser, headline, eCPM, status and the pause button
 * are what an operator scans and acts on, so those five never leave. Source goes at 48rem,
 * catalog at 64rem, and the content hash plus the three long targeting lists - the ones that
 * used to wrap the row into four lines - only at 96rem, where they genuinely fit. What stays is truncated in CSS with the whole value on the title attribute and, for the
 * hash, on a copy button on the creative's own page: nothing is lost, the row is always one
 * line, and the table's own scroller carries the rest without the page body moving sideways.
 *
 * The empty state distinguishes an empty catalog from a filter that matches nothing: those are
 * different problems with different next actions, and a bare "no results" tells you neither.
 */

export const dynamic = 'force-dynamic';

const list = (values: readonly string[]): string => (values.length === 0 ? '-' : values.join(', '));

const sourceLabel = (creative: CreativeRecord): string =>
  creative.network === null ? creative.source : `${creative.source} / ${creative.network}`;

const catalogLabel = (creative: CreativeRecord): string =>
  creative.appId === null ? 'Global' : (creative.appName ?? creative.appId);

const isFiltered = (filters: CreativeFilters): boolean =>
  filters.source !== ALL_FILTER || filters.active !== ALL_FILTER || filters.scope !== ALL_FILTER;

const CreativesPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const filters = parseCreativeFilters(await searchParams);
  const [creatives, apps] = await Promise.all([listCreatives(filters), listAppOptions()]);
  const filtered = isFiltered(filters);

  return (
    <section>
      <PageHeader
        title="Creatives"
        lede={`${String(creatives.length)} ${creatives.length === 1 ? 'creative' : 'creatives'} in view. Everything the demand path uses to choose one.`}
        actions={
          <Link href="/creatives/new" className="ag-btn ag-btn-primary">
            New creative
          </Link>
        }
      />

      <div className="mb-6">
        <CreativeFiltersForm filters={filters} apps={apps} />
      </div>

      {creatives.length === 0 ? (
        <EmptyState
          testId="creatives-empty"
          title={
            filtered
              ? 'No creatives match this view.'
              : 'The catalog is empty. No creatives match this view.'
          }
          actions={
            <>
              <Link href="/creatives/new" className="ag-btn ag-btn-primary">
                Add a creative
              </Link>
              {filtered ? (
                <Link href="/creatives" className="ag-btn">
                  Clear the filters
                </Link>
              ) : null}
            </>
          }
        >
          {filtered ? (
            <>
              The catalog is not empty - the source, status and catalog filters above are. Clearing
              them shows every creative this gateway can serve.
            </>
          ) : (
            <>
              A creative is one sponsored block a demand adapter can return: an advertiser, the
              copy, a destination, what it targets and what it pays. With none, every eligible turn
              ends in <span className="ag-code">no_fill</span>. Add one here, or import a file with{' '}
              <span className="ag-code">pnpm --filter @adgate/gateway seed-creatives</span>.
            </>
          )}
        </EmptyState>
      ) : (
        <div className="ag-table-scroll">
          <table className="ag-table">
            <thead>
              <tr>
                <th scope="col" className="table-head">
                  Advertiser
                </th>
                <th scope="col" className="table-head">
                  Headline
                </th>
                <th scope="col" className="table-head max-md:hidden">
                  Source
                </th>
                <th scope="col" className="table-head max-2xl:hidden">
                  Categories
                </th>
                <th scope="col" className="table-head max-2xl:hidden">
                  Regions
                </th>
                <th scope="col" className="table-head max-2xl:hidden">
                  Keywords
                </th>
                <th scope="col" className="table-head">
                  eCPM
                </th>
                <th scope="col" className="table-head max-lg:hidden">
                  Catalog
                </th>
                <th scope="col" className="table-head">
                  Status
                </th>
                <th scope="col" className="table-head max-2xl:hidden">
                  content_hash
                </th>
                <th scope="col" className="table-head">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {creatives.map((creative) => (
                <tr key={creative.id} data-testid="creative-row">
                  <td className="table-cell">
                    <span className="table-cell-strong ag-truncate" title={creative.advertiser}>
                      {creative.advertiser}
                    </span>
                    <span className="ag-mono-2xs ag-truncate" title={creative.advertiserDomain}>
                      {creative.advertiserDomain}
                    </span>
                  </td>
                  <td className="table-cell table-cell-strong">
                    <Link href={`/creatives/${creative.id}`} className="ag-link-quiet">
                      <span className="ag-truncate" title={creative.headline}>
                        {creative.headline}
                      </span>
                    </Link>
                  </td>
                  <td className="table-cell table-cell-nowrap max-md:hidden">
                    {sourceLabel(creative)}
                  </td>
                  <td className="table-cell max-2xl:hidden">
                    <span
                      className="ag-mono-2xs ag-truncate ag-truncate-sm"
                      title={list(creative.targetCategories)}
                    >
                      {list(creative.targetCategories)}
                    </span>
                  </td>
                  <td className="table-cell max-2xl:hidden">
                    <span
                      className="ag-mono-2xs ag-truncate ag-truncate-sm"
                      title={list(creative.targetRegions)}
                    >
                      {list(creative.targetRegions)}
                    </span>
                  </td>
                  <td className="table-cell max-2xl:hidden">
                    <span
                      className="ag-mono-2xs ag-truncate ag-truncate-sm"
                      title={list(creative.keywords)}
                    >
                      {list(creative.keywords)}
                    </span>
                  </td>
                  <td className="table-cell table-cell-nowrap">{formatAmount(creative.ecpm)}</td>
                  <td className="table-cell max-lg:hidden">
                    <span className="ag-truncate ag-truncate-sm" title={catalogLabel(creative)}>
                      {catalogLabel(creative)}
                    </span>
                  </td>
                  <td className="table-cell" data-testid="creative-status">
                    <span className={creative.active ? 'ag-badge ag-badge-ok' : 'ag-badge'}>
                      {creative.active ? 'active' : 'paused'}
                    </span>
                  </td>
                  <td
                    className="table-cell ag-mono-2xs table-cell-nowrap max-2xl:hidden"
                    title={creative.contentHash}
                  >
                    {truncateHash(creative.contentHash)}
                  </td>
                  <td className="table-cell">
                    <CreativeActiveToggle id={creative.id} active={creative.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default CreativesPage;
