import Link from 'next/link';

import {
  ALL_APPS,
  ANY_DECISION,
  ANY_REASON,
  type AuditFilters,
  DECISION_VALUES,
} from '@/lib/audit-filters';
import type { AppOption } from '@/lib/creative-issue';
import { formatReason } from '@/lib/format';

/**
 * The audit search controls: app, date range, decision and reason. A plain GET form whose
 * fields become the page's query string - no client component, no JavaScript - so the view is
 * a URL an operator can bookmark, paste into a ticket or send to an auditor.
 *
 * Submitting resets to the first page on purpose: the form carries no cursor, so a new search
 * always starts at the newest matching record instead of landing in the middle of the old one.
 */

const CONTROL =
  'rounded-md border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-stone-900';
const LABEL = 'block text-xs font-medium text-stone-500 uppercase';

export interface AuditFiltersFormProps {
  filters: AuditFilters;
  apps: readonly AppOption[];
  /** The reasons present in the current app and range, from the records themselves. */
  reasons: readonly string[];
}

export const AuditFiltersForm = ({ filters, apps, reasons }: AuditFiltersFormProps) => (
  <form method="get" action="/audit" className="card flex flex-wrap items-end gap-4">
    <div>
      <label htmlFor="app" className={LABEL}>
        App
      </label>
      <select id="app" name="app" defaultValue={filters.appId} className={`mt-1 ${CONTROL}`}>
        <option value={ALL_APPS}>All apps</option>
        {apps.map((app) => (
          <option key={app.id} value={app.id}>
            {app.name}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor="from" className={LABEL}>
        From (UTC)
      </label>
      <input
        id="from"
        name="from"
        type="date"
        defaultValue={filters.from}
        className={`mt-1 ${CONTROL}`}
      />
    </div>

    <div>
      <label htmlFor="to" className={LABEL}>
        To (UTC)
      </label>
      <input
        id="to"
        name="to"
        type="date"
        defaultValue={filters.to}
        className={`mt-1 ${CONTROL}`}
      />
    </div>

    <div>
      <label htmlFor="decision" className={LABEL}>
        Decision
      </label>
      <select
        id="decision"
        name="decision"
        defaultValue={filters.decision}
        className={`mt-1 ${CONTROL}`}
      >
        <option value={ANY_DECISION}>Any decision</option>
        {DECISION_VALUES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor="reason" className={LABEL}>
        Reason
      </label>
      <select id="reason" name="reason" defaultValue={filters.reason} className={`mt-1 ${CONTROL}`}>
        <option value={ANY_REASON}>Any reason</option>
        {reasons.map((reason) => (
          <option key={reason} value={reason}>
            {formatReason(reason)}
          </option>
        ))}
        {/* A reason still in the URL but no longer present in the range stays selectable, so
            reloading a shared link does not silently widen the search. */}
        {filters.reason !== ANY_REASON && !reasons.includes(filters.reason) ? (
          <option value={filters.reason}>{formatReason(filters.reason)}</option>
        ) : null}
      </select>
    </div>

    <button
      type="submit"
      data-testid="apply-audit-filters"
      className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
    >
      Search
    </button>
    <Link href="/audit" className="pb-2 text-sm text-stone-600 underline-offset-2 hover:underline">
      Clear
    </Link>
  </form>
);
