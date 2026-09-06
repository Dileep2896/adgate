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

const CONTROL = 'ag-input ag-input-auto mt-1';

export interface AuditFiltersFormProps {
  filters: AuditFilters;
  apps: readonly AppOption[];
  /** The reasons present in the current app and range, from the records themselves. */
  reasons: readonly string[];
}

export const AuditFiltersForm = ({ filters, apps, reasons }: AuditFiltersFormProps) => (
  <form method="get" action="/audit" className="card ag-filters">
    <div>
      <label htmlFor="app" className="ag-label">
        App
      </label>
      <select id="app" name="app" defaultValue={filters.appId} className={CONTROL}>
        <option value={ALL_APPS}>All apps</option>
        {apps.map((app) => (
          <option key={app.id} value={app.id}>
            {app.name}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor="from" className="ag-label">
        From (UTC)
      </label>
      <input id="from" name="from" type="date" defaultValue={filters.from} className={CONTROL} />
    </div>

    <div>
      <label htmlFor="to" className="ag-label">
        To (UTC)
      </label>
      <input id="to" name="to" type="date" defaultValue={filters.to} className={CONTROL} />
    </div>

    <div>
      <label htmlFor="decision" className="ag-label">
        Decision
      </label>
      <select id="decision" name="decision" defaultValue={filters.decision} className={CONTROL}>
        <option value={ANY_DECISION}>Any decision</option>
        {DECISION_VALUES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor="reason" className="ag-label">
        Reason
      </label>
      <select id="reason" name="reason" defaultValue={filters.reason} className={CONTROL}>
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

    <div className="ag-filters-actions">
      <button type="submit" data-testid="apply-audit-filters" className="ag-btn ag-btn-primary">
        Search
      </button>
      <Link href="/audit" className="ag-link-quiet text-xs">
        Clear
      </Link>
    </div>
  </form>
);
