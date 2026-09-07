'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { createAppAction } from '@/app/(dashboard)/apps/actions';
import { CopyButton } from '@/components/copy-button';
import { FormIssues } from '@/components/form-issues';
import { IntegrationPanel } from '@/components/integration-panel';
import { PageHeader } from '@/components/page-header';
import { type CreateAppState, INITIAL_CREATE_APP_STATE } from '@/lib/action-state';
import { API_KEY_ENV } from '@/lib/integration-snippets';

/**
 * Register an app, then show its first API key exactly once - and, beside it, everything
 * needed to use that key.
 *
 * HOW THE KEY REACHES THIS SCREEN, SAFELY: createAppAction RETURNS it, and useActionState puts
 * that return value in this component's React state. It is therefore only ever in the action's
 * response body and in this browser tab's memory. It is never put in a redirect, a query
 * string, the session cookie, localStorage or a log line - a redirect parameter would put a
 * live credential in the URL bar, the browser history and any access log in front of the app.
 * Reloading or leaving the page loses it for good, which is exactly right: adgate stores only
 * an argon2id hash of the secret and cannot show it again.
 *
 * THE SNIPPETS BESIDE IT NEVER CARRY THE KEY. They name ADGATE_API_KEY and nothing else, so
 * the panel below is safe to render again on the app's own page, where the secret is gone.
 * The one thing they do carry is this app's real id, which is public.
 */

const POLICY_PLACEHOLDER = [
  '# Optional. Leave blank for the documented defaults (docs/policy.md).',
  '# A pasted document is stored verbatim, including its app_id, exactly like',
  '# `create-app --policy file.yaml`. You can correct it on the app page afterwards.',
  'version: 1',
  'app_id: app_...',
  'min_commercial_intent: 0.75',
].join('\n');

const CreatedKey = ({
  state,
  first,
}: {
  state: Extract<CreateAppState, { status: 'created' }>;
  first: boolean;
}) => (
  <section data-testid="app-created" className="space-y-8">
    <PageHeader
      title={first ? `${state.app.name} is live` : `${state.app.name} created`}
      back={{ href: '/apps', label: 'All apps' }}
      meta={
        <>
          <span data-testid="created-app-id" className="ag-mono-2xs">
            {state.app.appId}
          </span>
          <span>policy v{String(state.app.policyVersion)}</span>
        </>
      }
      actions={
        <Link href={`/apps/${state.app.appId}`} className="ag-btn ag-btn-primary">
          Open {state.app.name}
        </Link>
      }
    />

    <div className="ag-note ag-note-warn">
      <h2 className="ag-section-title">Copy this API key now. It is shown once.</h2>
      <p className="mt-1">
        adgate stores only an argon2id hash of the secret, so this value cannot be retrieved again -
        not from this page, not from the database, not from a support request. If you lose it, issue
        a new key and revoke this one. Reloading this page loses it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code
          data-testid="api-key-value"
          className="ag-input ag-input-mono flex-1 overflow-x-auto break-all"
        >
          {state.app.apiKey}
        </code>
        <CopyButton value={state.app.apiKey} label="Copy key" testId="copy-api-key" />
      </div>
      <p className="ag-mono-2xs mt-2">
        key_id {state.app.keyId} - send it as: Authorization: Bearer &lt;api_key&gt;
      </p>
      <p className="mt-2">
        Put it in your server&apos;s environment as <span className="ag-code">{API_KEY_ENV}</span>,
        which is the name every snippet below reads. It is a server-side secret: it must never reach
        a browser or a user&apos;s machine.
      </p>
    </div>

    <IntegrationPanel
      appId={state.app.appId}
      lede="Three shapes, one app id. Wrap your model on the server, render the labeled block after the answer in the browser, or do both from Python."
    />
  </section>
);

export interface NewAppFormProps {
  /** The first-run wording: this account has no apps yet and arrived here from signup. */
  first?: boolean;
}

export const NewAppForm = ({ first = false }: NewAppFormProps) => {
  const [state, formAction, pending] = useActionState(createAppAction, INITIAL_CREATE_APP_STATE);

  if (state.status === 'created') {
    return <CreatedKey state={state} first={first} />;
  }

  return (
    <section>
      <PageHeader
        title={first ? 'Create your first app' : 'New app'}
        back={first ? undefined : { href: '/apps', label: 'All apps' }}
        lede={
          first
            ? 'One app is one place ads can appear: your chat product, your agent, one surface of it. It gets its own policy, its own API key and its own signed audit chain. Name it and the next screen has the key and the code.'
            : 'Registers a tenant and issues its first app-role API key. The key is shown once, on the next screen, together with the snippets that use it.'
        }
      />

      <form action={formAction} className="card max-w-3xl space-y-5">
        <div>
          <label htmlFor="name" className="ag-label-plain">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={120}
            autoFocus
            aria-describedby="name-hint"
            className="ag-input mt-1"
          />
          <p id="name-hint" className="ag-hint">
            Not unique: the same name again creates another app.
          </p>
        </div>

        {/*
          On the first run the policy editor is folded away. It is genuinely optional - a blank
          document stores the documented defaults - and ten rows of YAML in front of somebody who
          signed up ninety seconds ago is the step where they stop. It is open by default
          everywhere else, where an operator came here to paste one.
        */}
        <details open={!first} className="space-y-2">
          <summary className="ag-label-plain cursor-pointer">Starting policy (optional)</summary>
          {/* The summary is the visible heading; the control still needs a label of its own. */}
          <label htmlFor="policy_yaml" className="sr-only">
            Starting policy (optional)
          </label>
          <textarea
            id="policy_yaml"
            name="policy_yaml"
            rows={10}
            spellCheck={false}
            placeholder={POLICY_PLACEHOLDER}
            aria-describedby="policy-hint"
            className="ag-input ag-input-mono mt-1"
          />
          <p id="policy-hint" className="ag-hint">
            Blank stores the documented defaults (docs/policy.md) with this app&apos;s id. You can
            edit it on the app page whenever you like.
          </p>
        </details>

        {state.status === 'invalid' ? (
          <FormIssues errors={state.errors} issues={state.issues} testId="new-app-errors" />
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={pending}
            data-state={pending ? 'loading' : undefined}
            className="ag-btn ag-btn-primary"
          >
            {pending ? 'Creating…' : 'Create app'}
          </button>
          <Link href="/apps" className="ag-link-quiet text-xs">
            {first ? 'Skip for now' : 'Cancel'}
          </Link>
        </div>
      </form>
    </section>
  );
};
