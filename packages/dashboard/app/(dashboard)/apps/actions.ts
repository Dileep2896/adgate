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
import { requireSession, sessionOwnerId } from '@/lib/auth';
import { dashboardWriteDb } from '@/lib/db-write';
import { dashboardEnv } from '@/lib/env';
import { savePolicy } from '@/lib/policy-save';
import { listApiKeys } from '@/lib/queries';
import {
  issuesFromError,
  isPolicyValidationError,
  validatePolicyYaml,
} from '@/lib/policy-validation';
import { appIsVisible } from '@/lib/scope-queries';

/**
 * The app writes. Everything else reads through the read-only handle in lib/db.ts; these three
 * actions use lib/db-write.ts, and the writes themselves are the gateway's own registerApp /
 * revokeApiKey plus one policy UPDATE.
 *
 * A server action is a POST to the page's own URL and does NOT render the layout, so
 * requireSession() in app/(dashboard)/layout.tsx does not protect it: every action below
 * calls requireSession() itself. Middleware only checks that a cookie is present.
 *
 * OWNERSHIP IS CHECKED HERE, NOT ON THE PAGE THAT RENDERED THE FORM. A server action receives an
 * app id from the request, and the request is not the page: the two actions that take one call
 * appIsVisible() with the session's own scope before they touch anything, so a member posting
 * another member's app id changes nothing and is told nothing.
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
  const session = await requireSession();
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
    // THE OWNER IS THE SESSION, never a form field: an app created in the console belongs to the
    // account that created it - an admin's account included, so a later demotion still leaves
    // them their own apps. The break-glass operator has no account row, so their apps carry a
    // null owner, exactly like the ones `create-app` writes.
    created = await registerApp(writeDb(), {
      name,
      policyYaml,
      ownerUserId: sessionOwnerId(session),
    });
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
  const session = await requireSession();
  const parsed = parsePolicySaveForm(formData);
  if (!parsed.ok) {
    return { status: 'invalid', errors: parsed.errors, issues: [] };
  }
  // The app id came from the request, not from the page: an app this session cannot read is an
  // app it cannot write, and it gets the same words as a database refusal rather than a hint.
  if (!(await appIsVisible(session.scope, parsed.value.appId))) {
    return { status: 'invalid', errors: [WRITE_FAILED_MESSAGE], issues: [] };
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
 * Marks one API key revoked. Idempotent: revoking an already revoked key is a no-op.
 *
 * BOTH IDS ARE CHECKED. The app id must be one this session can read, and the key must belong to
 * that app - listApiKeys() is scoped, so asking it for the app's keys and looking for this one is
 * the same authorisation the page used to render the button. Without the second half, a key id
 * alone would be enough to revoke another account's key.
 */
export const revokeKeyAction = async (formData: FormData): Promise<void> => {
  const session = await requireSession();
  const parsed = parseRevokeKeyForm(formData);
  if (!parsed.ok) {
    return;
  }
  const keys = await listApiKeys(session.scope, parsed.value.appId);
  if (!keys.some((key) => key.keyId === parsed.value.keyId)) {
    return;
  }
  await revokeApiKey(writeDb(), parsed.value.keyId);
  revalidatePath(`/apps/${parsed.value.appId}`);
};
