'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { saveCreativeAction } from '@/app/(dashboard)/creatives/actions';
import { CreativeDeliveryFields } from '@/components/creative-delivery-fields';
import { Field, INPUT, MONO_INPUT } from '@/components/creative-field';
import { INITIAL_CREATIVE_SAVE_STATE } from '@/lib/action-state';
import {
  type AdvertiserOption,
  type AppOption,
  CONTENT_HASH_WARNING,
  type CreativeFieldIssue,
  type CreativeFormValues,
  issuesForField,
  NEW_ADVERTISER_VALUE,
} from '@/lib/creative-issue';

/**
 * Create and edit one creative. The same form does both: with a hidden id it updates, without
 * one it inserts, and on success saveCreativeAction redirects to the creative's own page.
 *
 * It imports lib/creative-issue.ts and NOTHING else from lib/: that module has no imports of its
 * own, while the validation (lib/creative-fields.ts) pulls in @adgate/schemas and @adgate/core,
 * which must never reach the browser bundle. Every rule is therefore decided on the server; the
 * only logic here is which inputs to show.
 */

export interface CreativeFormProps {
  values: CreativeFormValues;
  advertisers: readonly AdvertiserOption[];
  apps: readonly AppOption[];
  /** The content taxonomy, so the operator can see what a valid category looks like. */
  categories: readonly string[];
  mode: 'create' | 'edit';
}

interface CreativeFormBodyProps extends CreativeFormProps {
  issues: readonly CreativeFieldIssue[];
  formAction: (payload: FormData) => void;
  pending: boolean;
}

/**
 * Every input is UNCONTROLLED (defaultValue), including the two selects that decide what else
 * is shown - React 19 resets an uncontrolled form after its action runs, and a controlled value
 * it does not re-render would silently disagree with the DOM afterwards. The wrapper below
 * re-mounts this body on every refusal with the submitted values, so the reset restores them.
 */
const CreativeFormBody = ({
  values,
  advertisers,
  apps,
  categories,
  mode,
  issues,
  formAction,
  pending,
}: CreativeFormBodyProps) => {
  const [advertiserId, setAdvertiserId] = useState(values.advertiserId);
  const [source, setSource] = useState(values.source);
  const formIssues = issuesForField(issues, 'form');

  return (
    <form action={formAction} className="card space-y-5">
      <input type="hidden" name="id" value={values.id} />

      {formIssues.length > 0 ? (
        <div data-testid="creative-form-error" className="ag-note ag-note-danger">
          {formIssues.map((issue) => (
            <p key={issue.message}>
              <span aria-hidden="true">&#9888;&#xFE0E;</span> {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      <Field id="advertiser_id" label="Advertiser" field="advertiser_id" issues={issues}>
        <select
          id="advertiser_id"
          name="advertiser_id"
          defaultValue={values.advertiserId}
          onChange={(event) => {
            setAdvertiserId(event.target.value);
          }}
          className={INPUT}
        >
          {advertisers.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({option.domain})
            </option>
          ))}
          <option value={NEW_ADVERTISER_VALUE}>New advertiser...</option>
        </select>
      </Field>

      {advertiserId === NEW_ADVERTISER_VALUE ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="advertiser" label="Advertiser name" field="advertiser" issues={issues}>
            <input
              id="advertiser"
              name="advertiser"
              type="text"
              defaultValue={values.advertiserName}
              className={INPUT}
            />
          </Field>
          <Field
            id="advertiser_domain"
            label="Advertiser domain"
            field="advertiser_domain"
            issues={issues}
            hint="One name per domain: a domain already registered under another name is refused, because the name is part of every content_hash."
          >
            <input
              id="advertiser_domain"
              name="advertiser_domain"
              type="text"
              placeholder="exampledb.dev"
              defaultValue={values.advertiserDomain}
              className={INPUT}
            />
          </Field>
        </div>
      ) : null}

      <Field id="headline" label="Headline" field="headline" issues={issues}>
        <input
          id="headline"
          name="headline"
          type="text"
          defaultValue={values.headline}
          className={INPUT}
        />
      </Field>

      <Field id="body" label="Body" field="body" issues={issues}>
        <textarea id="body" name="body" rows={2} defaultValue={values.body} className={INPUT} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cta" label="Call to action" field="cta" issues={issues}>
          <input id="cta" name="cta" type="text" defaultValue={values.cta} className={INPUT} />
        </Field>
        <Field
          id="url_template"
          label="Destination URL"
          field="url_template"
          issues={issues}
          hint="Absolute http(s) URL. Affiliate templates may hold {{program_id}}, {{tag}} or {{u}}."
        >
          <input
            id="url_template"
            name="url_template"
            type="text"
            defaultValue={values.urlTemplate}
            className={MONO_INPUT}
          />
        </Field>
      </div>

      <Field
        id="target_categories"
        label="Target categories"
        field="target_categories"
        issues={issues}
        hint={
          <details>
            <summary className="cursor-pointer">
              Comma or newline separated. A trailing .* wildcard matches everything below it.
            </summary>
            <span className="ag-mono-2xs mt-1 block break-words">{categories.join(', ')}</span>
          </details>
        }
      >
        <textarea
          id="target_categories"
          name="target_categories"
          rows={2}
          defaultValue={values.targetCategories}
          className={MONO_INPUT}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id="target_regions"
          label="Target regions"
          field="target_regions"
          issues={issues}
          hint="ISO 3166-1 alpha-2 or EU. Empty means every region."
        >
          <input
            id="target_regions"
            name="target_regions"
            type="text"
            placeholder="US, CA, EU"
            defaultValue={values.targetRegions}
            className={MONO_INPUT}
          />
        </Field>
        <Field
          id="keywords"
          label="Keywords"
          field="keywords"
          issues={issues}
          hint="Dictionary terms that raise targeting_match."
        >
          <input
            id="keywords"
            name="keywords"
            type="text"
            defaultValue={values.keywords}
            className={INPUT}
          />
        </Field>
        <Field id="ecpm" label="eCPM" field="ecpm" issues={issues} hint="Per 1000 impressions.">
          <input
            id="ecpm"
            name="ecpm"
            type="text"
            inputMode="decimal"
            defaultValue={values.ecpm}
            className={INPUT}
          />
        </Field>
      </div>

      <CreativeDeliveryFields
        values={values}
        issues={issues}
        apps={apps}
        source={source}
        onSourceChange={setSource}
      />

      <p data-testid="content-hash-warning" className="ag-note ag-note-warn text-xs">
        {CONTENT_HASH_WARNING}
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          data-state={pending ? 'loading' : undefined}
          className="ag-btn ag-btn-primary"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Create creative' : 'Save creative'}
        </button>
        <Link href="/creatives" className="ag-link-quiet text-xs">
          Cancel
        </Link>
      </div>
    </form>
  );
};

/**
 * The editor. It owns the action state and re-mounts the body on every refusal (the `key`), so
 * the values React's form reset restores are the ones that were just submitted rather than the
 * ones the page was rendered with.
 */
export const CreativeForm = (props: CreativeFormProps) => {
  const [state, formAction, pending] = useActionState(
    saveCreativeAction,
    INITIAL_CREATIVE_SAVE_STATE,
  );
  const invalid = state.status === 'invalid';

  return (
    <CreativeFormBody
      key={invalid ? `attempt-${String(state.attempt)}` : 'initial'}
      {...props}
      values={invalid ? state.values : props.values}
      issues={invalid ? state.issues : []}
      formAction={formAction}
      pending={pending}
    />
  );
};
