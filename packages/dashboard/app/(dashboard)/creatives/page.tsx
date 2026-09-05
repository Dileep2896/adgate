import Link from 'next/link';

import { CreativeActiveToggle } from '@/components/creative-active-toggle';
import { CreativeFiltersForm } from '@/components/creative-filters';
import { formatAmount, truncateHash } from '@/lib/format';
import {
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
 */

export const dynamic = 'force-dynamic';

const list = (values: readonly string[]): string => (values.length === 0 ? '-' : values.join(', '));

const sourceLabel = (creative: CreativeRecord): string =>
  creative.network === null ? creative.source : `${creative.source} / ${creative.network}`;

const catalogLabel = (creative: CreativeRecord): string =>
  creative.appId === null ? 'Global' : (creative.appName ?? creative.appId);

const CreativesPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const filters = parseCreativeFilters(await searchParams);
  const [creatives, apps] = await Promise.all([listCreatives(filters), listAppOptions()]);

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Creatives</h1>
          <p className="mt-1 text-sm text-stone-500">
            {creatives.length} {creatives.length === 1 ? 'creative' : 'creatives'} in view
          </p>
        </div>
        <Link
          href="/creatives/new"
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          New creative
        </Link>
      </div>

      <div className="mb-6">
        <CreativeFiltersForm filters={filters} apps={apps} />
      </div>

      {creatives.length === 0 ? (
        <div className="card text-sm text-stone-600" data-testid="creatives-empty">
          <p className="font-medium text-stone-900">No creatives match this view.</p>
          <p className="mt-1">
            Add one with <Link href="/creatives/new">New creative</Link>, or import a file with{' '}
            <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">
              pnpm --filter @adgate/gateway seed-creatives
            </code>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full border-collapse">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className="table-head">Advertiser</th>
                <th className="table-head">Headline</th>
                <th className="table-head">Source</th>
                <th className="table-head">Categories</th>
                <th className="table-head">Regions</th>
                <th className="table-head">Keywords</th>
                <th className="table-head">eCPM</th>
                <th className="table-head">Catalog</th>
                <th className="table-head">Status</th>
                <th className="table-head">content_hash</th>
                <th className="table-head">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {creatives.map((creative) => (
                <tr key={creative.id} data-testid="creative-row">
                  <td className="table-cell">
                    <span className="font-medium text-stone-900">{creative.advertiser}</span>
                    <span className="block font-mono text-xs text-stone-500">
                      {creative.advertiserDomain}
                    </span>
                  </td>
                  <td className="table-cell font-medium text-stone-900">
                    <Link
                      href={`/creatives/${creative.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {creative.headline}
                    </Link>
                  </td>
                  <td className="table-cell">{sourceLabel(creative)}</td>
                  <td className="table-cell font-mono text-xs">
                    {list(creative.targetCategories)}
                  </td>
                  <td className="table-cell font-mono text-xs">{list(creative.targetRegions)}</td>
                  <td className="table-cell font-mono text-xs">{list(creative.keywords)}</td>
                  <td className="table-cell tabular-nums">{formatAmount(creative.ecpm)}</td>
                  <td className="table-cell">{catalogLabel(creative)}</td>
                  <td className="table-cell" data-testid="creative-status">
                    {creative.active ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        active
                      </span>
                    ) : (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                        paused
                      </span>
                    )}
                  </td>
                  <td
                    className="table-cell font-mono text-xs text-stone-500"
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
