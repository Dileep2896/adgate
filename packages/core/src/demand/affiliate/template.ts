import type { AffiliateBuildResult } from './types.js';

/**
 * Placeholder substitution for affiliate url_templates. Values come from the app owner's own
 * AffiliateConfig (docs/decisions.md item 6); this module never sees credentials and never
 * fetches anything. Every value is substituted as encodeURIComponent(value): in a query string
 * that is exactly what a parameter value needs, and in a path or host position an id is a plain
 * token, so the encoding is the identity. A whole-URL placeholder (a template that is only {{u}})
 * is therefore not supported: put the destination in a query parameter, as the seed file does.
 */
export const TEMPLATE_PLACEHOLDERS = [
  'program_id',
  'campaign_id',
  'tag',
  'u',
  'destination',
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

/** Values by placeholder; `destination` fills both {{destination}} and its alias {{u}}. */
export type TemplateValues = {
  readonly [K in Exclude<TemplatePlaceholder, 'u'>]?: string | undefined;
};

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

const isPlaceholder = (name: string): name is TemplatePlaceholder =>
  (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name);

const valueOf = (values: TemplateValues, name: TemplatePlaceholder): string | undefined =>
  name === 'u' ? values.destination : values[name];

/** True for an absolute http(s) URL, the only kind the click redirect may 302 to. */
export const isHttpUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

/**
 * Fills every {{placeholder}} in `template`. Fails, naming the first offending placeholder, on
 * an unknown name or on one whose value is missing or empty; fails with `invalid_url` when the
 * result is not an absolute http(s) URL and with `encode_failed` on a value that cannot be
 * percent-encoded. Never throws.
 */
export const fillTemplate = (template: string, values: TemplateValues): AffiliateBuildResult => {
  const failures: string[] = [];
  let url: string;
  try {
    url = template.replace(PLACEHOLDER, (_match, raw: string) => {
      const name = raw.trim();
      if (!isPlaceholder(name)) {
        failures.push(`unknown_placeholder:${name}`);
        return '';
      }
      const value = valueOf(values, name);
      if (value === undefined || value === '') {
        failures.push(`missing_placeholder:${name}`);
        return '';
      }
      return encodeURIComponent(value);
    });
  } catch {
    return { ok: false, error: 'encode_failed' };
  }
  const [first] = failures;
  if (first !== undefined) {
    return { ok: false, error: first };
  }
  return isHttpUrl(url) ? { ok: true, url } : { ok: false, error: 'invalid_url' };
};
