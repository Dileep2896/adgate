import { SeedCreative } from '@adgateio/schemas';

import { type FormFields, readText } from './app-form';
import {
  type CreativeFormContext,
  issue,
  MAX_BODY_LENGTH,
  MAX_CTA_LENGTH,
  MAX_HEADLINE_LENGTH,
  readAdvertiser,
  readAppId,
  readCategories,
  readEcpm,
  readField,
  readList,
  readRegions,
  readSource,
  readUrlTemplate,
} from './creative-fields';
import type { CreativeField, CreativeFieldIssue, CreativeFormValues } from './creative-issue';

/**
 * Reading the creative editor's form: strings in, a validated SeedCreative out, checked against
 * the catalog it is being written into (the known advertisers and app ids, passed in as plain
 * data). PURE - no database, no React, no environment - so every rule is a unit test.
 *
 * The last word belongs to SeedCreative.safeParse from @adgateio/schemas: the dashboard must not
 * be able to write a row the demand adapters would refuse to load (evaluate/adapters.ts
 * validates every catalog row with CatalogCreative and skips what fails). The per-field checks
 * in lib/creative-fields.ts exist to say WHICH input is wrong; the schema is what decides.
 *
 * SERVER ONLY. Client components use lib/creative-issue.ts, which imports nothing.
 */

export type { CreativeFormContext } from './creative-fields';
export {
  DOMAIN_PATTERN,
  isKnownTargetCategory,
  MAX_ECPM,
  MAX_LIST_ITEMS,
  splitList,
} from './creative-fields';

export interface CreativeFormValue {
  /** The creative being edited, or null when the form is creating one. */
  id: string | null;
  seed: SeedCreative;
  /** Null = the global catalog. */
  appId: string | null;
}

export type CreativeFormResult =
  { ok: true; value: CreativeFormValue } | { ok: false; issues: CreativeFieldIssue[] };

/** A zod path from SeedCreative back onto a form field; anything unexpected is a form error. */
const KNOWN_PATHS: readonly CreativeField[] = [
  'advertiser',
  'advertiser_domain',
  'headline',
  'body',
  'cta',
  'url_template',
  'target_categories',
  'target_regions',
  'keywords',
  'ecpm',
  'source',
  'network',
  'program_id',
];

const fieldOfPath = (path: PropertyKey | undefined): CreativeField =>
  KNOWN_PATHS.find((field) => field === path) ?? 'form';

export const parseCreativeForm = (
  form: FormFields,
  context: CreativeFormContext,
): CreativeFormResult => {
  const issues: CreativeFieldIssue[] = [];
  const advertiser = readAdvertiser(form, context, issues);
  const headline = readField(form, 'headline', 'headline', MAX_HEADLINE_LENGTH, issues);
  const body = readField(form, 'body', 'body', MAX_BODY_LENGTH, issues, false);
  const cta = readField(form, 'cta', 'call to action', MAX_CTA_LENGTH, issues);
  const urlTemplate = readUrlTemplate(form, issues);
  const targetCategories = readCategories(form, issues);
  const targetRegions = readRegions(form, issues);
  const keywords = readList(form, 'keywords', 'keyword', issues);
  const ecpm = readEcpm(form, issues);
  const source = readSource(form, issues);
  const appId = readAppId(form, context, issues);
  const active = readText(form, 'active') !== '';
  const id = readText(form, 'id').trim();

  if (issues.length > 0 || advertiser === null) {
    return { ok: false, issues };
  }

  const parsed = SeedCreative.safeParse({
    ...advertiser,
    headline,
    body,
    cta,
    url_template: urlTemplate,
    target_categories: targetCategories,
    target_regions: targetRegions,
    keywords,
    ecpm,
    active,
    ...source,
  });
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((problem) =>
        issue(fieldOfPath(problem.path[0]), problem.message),
      ),
    };
  }
  return { ok: true, value: { id: id === '' ? null : id, seed: parsed.data, appId } };
};

/**
 * The form exactly as it was submitted, unvalidated and untrimmed.
 *
 * WHY THIS EXISTS: React 19 RESETS an uncontrolled form once its action has run, back to the
 * defaultValue of each input. A refused save would therefore wipe everything the operator
 * typed, which is unusable for a form this size. The action returns these values with the
 * issues and the editor re-renders with them as the new defaults, so the reset restores the
 * submitted text instead of clearing it.
 */
export const readCreativeFormValues = (form: FormFields): CreativeFormValues => ({
  id: readText(form, 'id'),
  advertiserId: readText(form, 'advertiser_id'),
  advertiserName: readText(form, 'advertiser'),
  advertiserDomain: readText(form, 'advertiser_domain'),
  headline: readText(form, 'headline'),
  body: readText(form, 'body'),
  cta: readText(form, 'cta'),
  urlTemplate: readText(form, 'url_template'),
  targetCategories: readText(form, 'target_categories'),
  targetRegions: readText(form, 'target_regions'),
  keywords: readText(form, 'keywords'),
  ecpm: readText(form, 'ecpm'),
  source: readText(form, 'source'),
  network: readText(form, 'network'),
  programId: readText(form, 'program_id'),
  active: readText(form, 'active') !== '',
  appId: readText(form, 'app_id'),
});
