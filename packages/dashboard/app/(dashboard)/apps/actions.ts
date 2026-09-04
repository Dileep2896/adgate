'use server';

import { registerApp, revokeApiKey } from '@adgate/gateway/admin';
import { revalidatePath } from 'next/cache';

import {
  type CreateAppState,
  type PolicySaveState,
  WRITE_FAILED_MESSAGE,
} from '@/lib/action-state';
import { createPolicyWriter } from '@/lib/admin-store';
import { parseNewAppForm, parsePolicySaveForm, parseRevokeKeyForm } from '@/lib/app-form';
import { requireSession } from '@/lib/auth';
import { dashboardWriteDb } from '@/lib/db-write';
import { dashboardEnv } from '@/lib/env';
import { savePolicy } from '@/lib/policy-save';
import {
  issuesFromError,
  isPolicyValidationError,
  validatePolicyYaml,
} from '@/lib/policy-validation';

/**
 * The only code in the dashboard that writes. Everything else reads through the read-only
 * handle in lib/db.ts; these three actions use lib/db-write.ts, and the writes themselves are
 * the gateway's own registerApp / revokeApiKey plus one policy UPDATE.
 *
 * A server action is a POST to the page's own URL and does NOT render the layout, so
 * requireSession() in app/(dashboard)/layout.tsx does not protect it: every action below
 * calls requireSession() itself. Middleware only checks that a cookie is present.
 *
 * Nothing here logs. The API key registerApp returns is put in the action's return value, read
 * into React state by the form, shown once and forgotten; it is never redirected through a
 * URL, never stored in the session or a cookie, and never written to a log.
 */

const writeDb = () => dashboardWriteDb(dashboardEnv().databaseUrl);

/**
 * Registers an app and returns its first API key exactly once. A policy document that does not
 * validate is reported inline and nothing is written: registerApp validates inside its
 * transaction too, and this pre-check only exists so the operator gets the schema issues in
 * the form instead of a thrown error.
 */
export const createAppAction = async (
  _previous: CreateAppState,
  formData: FormData,
): Promise<CreateAppState> => {
  await requireSession();
  const parsed = parseNewAppForm(formData);
  if (!parsed.ok) {
    return { status: 'invalid', errors: parsed.errors, issues: [] };
  }
  const { name, policyYaml } = parsed.value;
  if (policyYaml !== undefined) {
    const validation = validatePolicyYaml(policyYaml);
    if (!validation.ok) {
      return { status: 'invalid', errors: [], issues: validation.issues };
    }
  }

  let created;
  try {
    created = await registerApp(writeDb(), { name, policyYaml });
  } catch (error) {
    if (isPolicyValidationError(error)) {
      return { status: 'invalid', errors: [], issues: issuesFromError(error) };
    }
    return { status: 'invalid', errors: [WRITE_FAILED_MESSAGE], issues: [] };
  }

  revalidatePath('/apps');
  return {
    status: 'created',
    app: {
      appId: created.app.id,
      name: created.app.name,
      keyId: created.key.key_id,
      policyHash: created.app.policyHash,
      policyVersion: created.app.policyVersion,
      apiKey: created.key.api_key,
    },
  };
};

/**
 * Validates the edited YAML and, only when it is valid, stores it with its new policy_hash and
 * a policy_version one higher. An invalid document writes nothing at all (lib/policy-save.ts).
 */
export const savePolicyAction = async (
  _previous: PolicySaveState,
  formData: FormData,
): Promise<PolicySaveState> => {
  await requireSession();
  const parsed = parsePolicySaveForm(formData);
  if (!parsed.ok) {
    return { status: 'invalid', errors: parsed.errors, issues: [] };
  }

  let result;
  try {
    result = await savePolicy(createPolicyWriter(writeDb()), parsed.value);
  } catch {
    return { status: 'invalid', errors: [WRITE_FAILED_MESSAGE], issues: [] };
  }
  if (!result.ok) {
    return { status: 'invalid', errors: [], issues: result.issues };
  }

  revalidatePath('/apps');
  revalidatePath(`/apps/${parsed.value.appId}`);
  return { status: 'saved', policyVersion: result.policyVersion, policyHash: result.policyHash };
};

/**
 * Marks one API key revoked. Idempotent: revoking an already revoked key is a no-op. There is
 * one operator with one password, so the key id is not additionally scoped to the app; the
 * app id in the form is only what the page revalidates afterwards.
 */
export const revokeKeyAction = async (formData: FormData): Promise<void> => {
  await requireSession();
  const parsed = parseRevokeKeyForm(formData);
  if (!parsed.ok) {
    return;
  }
  await revokeApiKey(writeDb(), parsed.value.keyId);
  revalidatePath(`/apps/${parsed.value.appId}`);
};
