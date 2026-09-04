'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { createAppAction } from '@/app/(dashboard)/apps/actions';
import { CopyButton } from '@/components/copy-button';
import { FormIssues } from '@/components/form-issues';
import { type CreateAppState, INITIAL_CREATE_APP_STATE } from '@/lib/action-state';

/**
 * Register an app, then show its first API key exactly once.
 *
 * HOW THE KEY REACHES THIS SCREEN, SAFELY: createAppAction RETURNS it, and useActionState puts
 * that return value in this component's React state. It is therefore only ever in the action's
 * response body and in this browser tab's memory. It is never put in a redirect, a query
 * string, the session cookie, localStorage or a log line - a redirect parameter would put a
 * live credential in the URL bar, the browser history and any access log in front of the app.
 * Reloading or leaving the page loses it for good, which is exactly right: adgate stores only
 * an argon2id hash of the secret and cannot show it again.
 */

const TEXTAREA_CLASS =
  'mt-1 w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-xs outline-none focus:border-stone-900';

const POLICY_PLACEHOLDER = [
  '# Optional. Leave blank for the documented defaults (docs/policy.md).',
  '# A pasted document is stored verbatim, including its app_id, exactly like',
  '# `create-app --policy file.yaml`. You can correct it on the app page afterwards.',
  'version: 1',
  'app_id: app_...',
  'min_commercial_intent: 0.75',
].join('\n');

const CreatedKey = ({ state }: { state: Extract<CreateAppState, { status: 'created' }> }) => (
  <section data-testid="app-created">
    <h1 className="text-2xl font-semibold tracking-tight">{state.app.name} created</h1>
    <p className="mt-1 mb-6 text-sm text-stone-500">
      <span data-testid="created-app-id" className="font-mono">
        {state.app.appId}
      </span>{' '}
      - policy v{String(state.app.policyVersion)}
    </p>

    <div className="card border-amber-300 bg-amber-50">
      <h2 className="text-sm font-semibold text-amber-900">
        Copy this API key now. It is shown once.
      </h2>
      <p className="mt-1 text-sm text-amber-900">
        adgate stores only an argon2id hash of the secret, so this value cannot be retrieved again -
        not from this page, not from the database, not from a support request. If you lose it, issue
        a new key and revoke this one. Reloading this page loses it.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code
          data-testid="api-key-value"
          className="flex-1 overflow-x-auto rounded border border-amber-300 bg-white px-3 py-2 font-mono text-xs break-all"
        >
          {state.app.apiKey}
        </code>
        <CopyButton value={state.app.apiKey} label="Copy key" testId="copy-api-key" />
      </div>
      <p className="mt-2 font-mono text-xs text-amber-900">
        key_id {state.app.keyId} - send it as: Authorization: Bearer &lt;api_key&gt;
      </p>
    </div>

    <div className="mt-6 flex items-center gap-4 text-sm">
      <Link
        href={`/apps/${state.app.appId}`}
        className="rounded-md bg-stone-900 px-3 py-2 font-medium text-white hover:bg-stone-800"
      >
        Open {state.app.name}
      </Link>
      <Link href="/apps" className="text-stone-600 underline-offset-2 hover:underline">
        Back to apps
      </Link>
    </div>
  </section>
);

export const NewAppForm = () => {
  const [state, formAction, pending] = useActionState(createAppAction, INITIAL_CREATE_APP_STATE);

  if (state.status === 'created') {
    return <CreatedKey state={state} />;
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">New app</h1>
      <p className="mt-1 mb-6 text-sm text-stone-500">
        Registers a tenant and issues its first app-role API key. The key is shown once, on the next
        screen.
      </p>

      <form action={formAction} className="card space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-stone-700">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={120}
            autoFocus
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
          />
          <p className="mt-1 text-xs text-stone-500">
            Not unique: the same name again creates another app.
          </p>
        </div>

        <div>
          <label htmlFor="policy_yaml" className="block text-sm font-medium text-stone-700">
            Starting policy (optional)
          </label>
          <textarea
            id="policy_yaml"
            name="policy_yaml"
            rows={10}
            spellCheck={false}
            placeholder={POLICY_PLACEHOLDER}
            className={TEXTAREA_CLASS}
          />
          <p className="mt-1 text-xs text-stone-500">
            Blank stores the documented defaults (docs/policy.md) with this app&apos;s id.
          </p>
        </div>

        {state.status === 'invalid' ? (
          <FormIssues errors={state.errors} issues={state.issues} testId="new-app-errors" />
        ) : null}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {pending ? 'Creating...' : 'Create app'}
          </button>
          <Link href="/apps" className="text-sm text-stone-600 underline-offset-2 hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
};
