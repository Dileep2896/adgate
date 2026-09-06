'use client';

import { useActionState } from 'react';

import { savePolicyAction } from '@/app/(dashboard)/apps/actions';
import { CopyButton } from '@/components/copy-button';
import { FormIssues } from '@/components/form-issues';
import { INITIAL_POLICY_SAVE_STATE } from '@/lib/action-state';
import { formatPolicyVersion } from '@/lib/format';

/**
 * The policy editor: the stored YAML in a textarea, its policy_hash, and Save.
 *
 * On submit savePolicyAction runs loadPolicyFromYaml. If that fails the action returns the
 * schema issues and writes NOTHING, so the hash and the version below stay exactly where they
 * were and the textarea keeps the document the operator was editing (it is uncontrolled, so a
 * re-render never resets what they typed). On success the action returns the new version and
 * hash and they replace the values shown here.
 */

export interface PolicyEditorProps {
  appId: string;
  policyYaml: string;
  policyHash: string;
  policyVersion: number;
}

export const PolicyEditor = ({
  appId,
  policyYaml,
  policyHash,
  policyVersion,
}: PolicyEditorProps) => {
  const [state, formAction, pending] = useActionState(savePolicyAction, INITIAL_POLICY_SAVE_STATE);

  const currentHash = state.status === 'saved' ? state.policyHash : policyHash;
  const currentVersion = state.status === 'saved' ? state.policyVersion : policyVersion;

  return (
    <form action={formAction} className="card space-y-4">
      <input type="hidden" name="app_id" value={appId} />

      <div className="ag-section-head">
        <h2 className="ag-section-title">Policy</h2>
        <p className="ag-meta">
          <span data-testid="policy-version" className="ag-mono-2xs">
            {formatPolicyVersion(currentVersion)}
          </span>
          <code data-testid="policy-hash" className="ag-mono-2xs break-all">
            {currentHash}
          </code>
          <CopyButton value={currentHash} label="Copy hash" testId="copy-policy-hash" />
        </p>
      </div>

      <textarea
        id="policy_yaml"
        name="policy_yaml"
        aria-label="Policy YAML"
        rows={22}
        spellCheck={false}
        defaultValue={policyYaml}
        className="ag-input ag-input-mono"
      />

      {state.status === 'invalid' ? (
        <FormIssues errors={state.errors} issues={state.issues} testId="policy-errors" />
      ) : null}
      {state.status === 'saved' ? (
        <p data-testid="policy-saved" className="ag-note ag-note-ok">
          Saved as {formatPolicyVersion(state.policyVersion)}. New policy_hash{' '}
          <span className="ag-mono-2xs break-all">{state.policyHash}</span>.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          data-state={pending ? 'loading' : undefined}
          className="ag-btn ag-btn-primary"
        >
          {pending ? 'Saving…' : 'Save policy'}
        </button>
        <p className="ag-hint">
          Saving bumps policy_version and rewrites policy_hash. Every audit record written after it
          carries the new hash.
        </p>
      </div>
    </form>
  );
};
