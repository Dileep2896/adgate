/**
 * Reading the admin forms. Pure string work over anything with a FormData-shaped `get`, so
 * the server actions stay three lines of wiring and the rules are unit tested without a
 * browser, a database or React.
 *
 * Nothing here trusts the request: a field that is not a string, is blank or is absurdly long
 * is a form error, never an exception and never a database round trip.
 */

export const MAX_APP_NAME_LENGTH = 120;
/** A policy document is a page of YAML, not an upload. 64 KiB is far more than any real one. */
export const MAX_POLICY_YAML_LENGTH = 64 * 1024;

/** The part of FormData these helpers use. Tests pass a real FormData or a one-method stub. */
export interface FormFields {
  get(name: string): unknown;
}

export type FormResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** The field as a string, or '' when it is missing or was sent as a file. */
export const readText = (form: FormFields, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

export interface NewAppInput {
  name: string;
  /** Undefined when the operator left the editor blank: registerApp writes the defaults. */
  policyYaml: string | undefined;
}

/**
 * The /apps/new form. The name is trimmed and required; the policy is stored verbatim
 * (whitespace inside a YAML document is meaningful) and a blank one means "use the documented
 * defaults", which is what `create-app` without --policy does.
 */
export const parseNewAppForm = (form: FormFields): FormResult<NewAppInput> => {
  const errors: string[] = [];
  const name = readText(form, 'name').trim();
  if (name === '') {
    errors.push('Enter a name for the app.');
  } else if (name.length > MAX_APP_NAME_LENGTH) {
    errors.push(`Name must be at most ${String(MAX_APP_NAME_LENGTH)} characters.`);
  }

  const rawPolicy = readText(form, 'policy_yaml');
  if (rawPolicy.length > MAX_POLICY_YAML_LENGTH) {
    errors.push(`Policy must be at most ${String(MAX_POLICY_YAML_LENGTH)} characters.`);
  }
  const policyYaml = rawPolicy.trim() === '' ? undefined : rawPolicy;

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, policyYaml } };
};

export interface PolicySaveInput {
  appId: string;
  policyYaml: string;
}

/**
 * The /apps/[id] editor form. An empty document is rejected here rather than handed to the
 * parser, because "you deleted everything" is a clearer message than what YAML says about it.
 */
export const parsePolicySaveForm = (form: FormFields): FormResult<PolicySaveInput> => {
  const errors: string[] = [];
  const appId = readText(form, 'app_id').trim();
  if (appId === '') {
    errors.push('Missing app id.');
  }
  const policyYaml = readText(form, 'policy_yaml');
  if (policyYaml.trim() === '') {
    errors.push('The policy document is empty.');
  } else if (policyYaml.length > MAX_POLICY_YAML_LENGTH) {
    errors.push(`Policy must be at most ${String(MAX_POLICY_YAML_LENGTH)} characters.`);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: { appId, policyYaml } };
};

export interface RevokeKeyInput {
  appId: string;
  keyId: string;
}

/** The per-key Revoke button. Both ids come from hidden fields, so both are checked. */
export const parseRevokeKeyForm = (form: FormFields): FormResult<RevokeKeyInput> => {
  const appId = readText(form, 'app_id').trim();
  const keyId = readText(form, 'key_id').trim();
  const errors = [
    ...(appId === '' ? ['Missing app id.'] : []),
    ...(keyId === '' ? ['Missing key id.'] : []),
  ];
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { appId, keyId } };
};
