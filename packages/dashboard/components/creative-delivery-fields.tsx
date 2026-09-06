'use client';

import { Field, INPUT } from '@/components/creative-field';
import {
  AFFILIATE_NETWORK_VALUES,
  type AppOption,
  CREATIVE_SOURCE_VALUES,
  type CreativeFieldIssue,
  type CreativeFormValues,
  GLOBAL_CATALOG_VALUE,
} from '@/lib/creative-issue';

/**
 * How a creative is delivered rather than what it says: which demand source answers with it,
 * the affiliate network that turns its template into a tracked link, which catalog it is in and
 * whether it runs at all.
 *
 * The network and program id inputs only exist while the source is affiliate - a direct creative
 * has no network, and the server drops both fields for one.
 */

export interface CreativeDeliveryFieldsProps {
  values: CreativeFormValues;
  issues: readonly CreativeFieldIssue[];
  apps: readonly AppOption[];
  source: string;
  onSourceChange: (source: string) => void;
}

export const CreativeDeliveryFields = ({
  values,
  issues,
  apps,
  source,
  onSourceChange,
}: CreativeDeliveryFieldsProps) => (
  <>
    <div className="grid gap-4 sm:grid-cols-3">
      <Field id="source" label="Source" field="source" issues={issues}>
        <select
          id="source"
          name="source"
          defaultValue={values.source}
          onChange={(event) => {
            onSourceChange(event.target.value);
          }}
          className={INPUT}
        >
          {CREATIVE_SOURCE_VALUES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </Field>

      {source === 'affiliate' ? (
        <>
          <Field id="network" label="Affiliate network" field="network" issues={issues}>
            <select id="network" name="network" defaultValue={values.network} className={INPUT}>
              <option value="">Choose a network...</option>
              {AFFILIATE_NETWORK_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="program_id"
            label="Program id (optional)"
            field="program_id"
            issues={issues}
            hint="Overrides the app's AffiliateConfig id for this creative. Ignored for amazon."
          >
            <input
              id="program_id"
              name="program_id"
              type="text"
              defaultValue={values.programId}
              className={INPUT}
            />
          </Field>
        </>
      ) : null}
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        id="app_id"
        label="Catalog"
        field="app_id"
        issues={issues}
        hint="Global creatives may be served by every app; a private one only by the app named here."
      >
        <select id="app_id" name="app_id" defaultValue={values.appId} className={INPUT}>
          <option value={GLOBAL_CATALOG_VALUE}>Global catalog</option>
          {apps.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name} ({app.id})
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-end">
        <label htmlFor="active" className="ag-check">
          <input id="active" name="active" type="checkbox" defaultChecked={values.active} />
          Active (an inactive creative is never returned by any adapter)
        </label>
      </div>
    </div>
  </>
);
