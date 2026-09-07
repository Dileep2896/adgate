'use client';

import { useActionState } from 'react';

import { saveAffiliateAction } from '@/app/(dashboard)/apps/actions';
import { DocRef } from '@/components/doc-ref';
import { type AffiliateSaveState, INITIAL_AFFILIATE_SAVE_STATE } from '@/lib/action-state';
import {
  AMAZON_MARKETPLACE_VALUES,
  type AffiliateField,
  type AffiliateFieldIssue,
  type AffiliateFormValues,
  affiliateIssuesForField,
} from '@/lib/affiliate-issue';

/**
 * The app owner's own affiliate accounts. Without them every affiliate demand entry answers
 * `affiliate_not_configured`, the turn ends in `no_fill`, and the app earns nothing however well
 * it is integrated - so this section says that in words rather than leaving it to be discovered in
 * an audit trace.
 *
 * NOT SECRETS, AND THE COPY SAYS SO. These are the public identifiers that already appear in every
 * tracked link (docs/decisions.md item 6): a PartnerStack program id, an impact.com program and
 * campaign, an Associates tag. adgate never holds an affiliate API key or a payout detail, which is
 * why - unlike the API key one screen up - the stored values are shown again on every page load.
 *
 * It imports lib/affiliate-issue.ts and NOTHING else from lib/: that module has no imports of its
 * own, while the parser (lib/affiliate-form.ts) pulls in @adgateio/schemas, which must never reach
 * the browser bundle. Every rule is decided on the server.
 */

export interface AffiliateFormProps {
  appId: string;
  values: AffiliateFormValues;
}

const INPUT = 'ag-input mt-1';

const Field = ({
  id,
  label,
  field,
  issues,
  hint,
  children,
}: {
  id: string;
  label: string;
  field: AffiliateField;
  issues: readonly AffiliateFieldIssue[];
  hint?: string;
  children: React.ReactNode;
}) => {
  const found = affiliateIssuesForField(issues, field);
  return (
    <div>
      <label htmlFor={id} className="ag-label-plain">
        {label}
      </label>
      {children}
      {found.length > 0 ? (
        found.map((problem) => (
          <p key={problem.message} role="alert" className="ag-field-error">
            {problem.message}
          </p>
        ))
      ) : hint === undefined ? null : (
        <p className="ag-hint">{hint}</p>
      )}
    </div>
  );
};

/**
 * Uncontrolled inputs and a keyed re-mount, for the reason lib/action-state.ts records: React 19
 * resets an uncontrolled form once its action has run, so the body is re-mounted on every attempt
 * with the state's values as its new defaults and nothing typed is lost.
 */
const AffiliateFormBody = ({
  appId,
  values,
  issues,
  formAction,
  pending,
  saved,
}: {
  appId: string;
  values: AffiliateFormValues;
  issues: readonly AffiliateFieldIssue[];
  formAction: (payload: FormData) => void;
  pending: boolean;
  saved: string[] | null;
}) => {
  const formIssues = affiliateIssuesForField(issues, 'form');
  return (
    <form action={formAction} className="card space-y-5">
      <input type="hidden" name="app_id" value={appId} />

      {formIssues.length > 0 ? (
        <div data-testid="affiliate-errors" className="ag-note ag-note-danger">
          {formIssues.map((problem) => (
            <p key={problem.message}>{problem.message}</p>
          ))}
        </div>
      ) : null}

      {saved === null ? null : (
        <p data-testid="affiliate-saved" className="ag-note ag-note-ok">
          {saved.length === 0
            ? 'Saved. No affiliate network is configured, so affiliate demand will answer affiliate_not_configured.'
            : `Saved. Configured: ${saved.join(', ')}. The gateway picks this up on the next evaluation.`}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="partnerstack_program_id"
          label="PartnerStack program id"
          field="partnerstack_program_id"
          issues={issues}
          hint="Fills {{program_id}} in a PartnerStack url_template. Blank switches PartnerStack off."
        >
          <input
            id="partnerstack_program_id"
            name="partnerstack_program_id"
            type="text"
            defaultValue={values.partnerstackProgramId}
            spellCheck={false}
            className={INPUT}
          />
        </Field>

        <Field
          id="amazon_tag"
          label="Amazon Associates tag"
          field="amazon_tag"
          issues={issues}
          hint="e.g. mysite-20. Always appended as the last tag= parameter; any tag already in the link is dropped."
        >
          <input
            id="amazon_tag"
            name="amazon_tag"
            type="text"
            defaultValue={values.amazonTag}
            spellCheck={false}
            className={INPUT}
          />
        </Field>

        <Field
          id="impact_program_id"
          label="impact.com program id"
          field="impact_program_id"
          issues={issues}
          hint="Fills {{program_id}}. Blank switches impact.com off."
        >
          <input
            id="impact_program_id"
            name="impact_program_id"
            type="text"
            defaultValue={values.impactProgramId}
            spellCheck={false}
            className={INPUT}
          />
        </Field>

        <Field
          id="impact_campaign_id"
          label="impact.com campaign id (optional)"
          field="impact_campaign_id"
          issues={issues}
          hint="Only for templates that carry {{campaign_id}}."
        >
          <input
            id="impact_campaign_id"
            name="impact_campaign_id"
            type="text"
            defaultValue={values.impactCampaignId}
            spellCheck={false}
            className={INPUT}
          />
        </Field>

        <Field
          id="amazon_marketplace"
          label="Amazon storefront"
          field="amazon_marketplace"
          issues={issues}
          hint="Tags are per storefront: set this and a link to another storefront is refused rather than credited to nobody."
        >
          <select
            id="amazon_marketplace"
            name="amazon_marketplace"
            defaultValue={values.amazonMarketplace}
            className={INPUT}
          >
            <option value="">Any storefront</option>
            {AMAZON_MARKETPLACE_VALUES.map((value) => (
              <option key={value} value={value}>
                amazon.{value}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          data-state={pending ? 'loading' : undefined}
          data-testid="save-affiliate"
          className="ag-btn ag-btn-primary"
        >
          {pending ? 'Saving…' : 'Save affiliate accounts'}
        </button>
        <span className="ag-hint">
          Public identifiers only — adgate never stores an affiliate API key or a payout detail.
          Which networks are queried at all is the <span className="ag-code">demand</span> list in
          the policy above; see <DocRef doc="policy" />.
        </span>
      </div>
    </form>
  );
};

export const AffiliateForm = ({ appId, values }: AffiliateFormProps) => {
  const [state, formAction, pending] = useActionState(
    saveAffiliateAction,
    INITIAL_AFFILIATE_SAVE_STATE,
  );
  const current: AffiliateSaveState = state;
  const shown = current.status === 'idle' ? values : current.values;

  return (
    <AffiliateFormBody
      key={current.status === 'idle' ? 'initial' : `attempt-${String(current.attempt)}`}
      appId={appId}
      values={shown}
      issues={current.status === 'invalid' ? current.issues : []}
      saved={current.status === 'saved' ? current.configured : null}
      formAction={formAction}
      pending={pending}
    />
  );
};
