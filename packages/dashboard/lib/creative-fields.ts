import { isHttpUrl } from '@adgate/core';
import { AffiliateNetwork, CATEGORIES_TAXONOMY, TARGET_CATEGORY_PATTERN } from '@adgate/schemas';

import { type FormFields, readText } from './app-form';
import {
  type AdvertiserOption,
  CREATIVE_SOURCE_VALUES,
  type CreativeField,
  type CreativeFieldIssue,
  NEW_ADVERTISER_VALUE,
} from './creative-issue';

/**
 * One field of the creative editor at a time: read it, normalize it, and say what is wrong with
 * it in words an operator can act on. Pure - strings and plain data only, no database, no React,
 * no environment - so every rule is unit tested (lib/creative-form.test.ts).
 *
 * lib/creative-form.ts assembles these into a SeedCreative and lets @adgate/schemas have the
 * final word; the messages here exist so a rejection names the input that caused it.
 *
 * SERVER ONLY (it imports @adgate/schemas and @adgate/core). Client components use
 * lib/creative-issue.ts, which imports nothing.
 */

export const MAX_HEADLINE_LENGTH = 200;
export const MAX_BODY_LENGTH = 500;
export const MAX_CTA_LENGTH = 60;
export const MAX_URL_LENGTH = 2000;
export const MAX_PROGRAM_ID_LENGTH = 200;
export const MAX_LIST_ITEMS = 50;
/** creatives.ecpm is numeric(12,4): four decimals and eight digits in front of them. */
export const MAX_ECPM = 99_999_999.9999;

/** A domain, and only a domain: no scheme, port, path or spaces (advertisers.domain). */
export const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export interface CreativeFormContext {
  /** Every advertiser already in the database: the select's options and the domain rule. */
  advertisers: readonly AdvertiserOption[];
  /** Every app id, so "private catalog of app X" cannot name an app that is not there. */
  appIds: readonly string[];
}

export const issue = (field: CreativeField, message: string): CreativeFieldIssue => ({
  field,
  message,
});

/**
 * A taxonomy category (software.devtools.database) or a wildcard over one or more of them
 * (software.devtools.*). A wildcard that matches nothing in the taxonomy is refused: it would
 * be a creative that can never be selected, which is a typo, not a targeting choice. The
 * prefix test is exactly core's matchesTargetCategory.
 */
export const isKnownTargetCategory = (target: string): boolean => {
  if (!TARGET_CATEGORY_PATTERN.test(target)) {
    return false;
  }
  if (target.endsWith('.*')) {
    const prefix = target.slice(0, -1);
    return CATEGORIES_TAXONOMY.some(
      (category) => category.length > prefix.length && category.startsWith(prefix),
    );
  }
  return (CATEGORIES_TAXONOMY as readonly string[]).includes(target);
};

/** Commas and newlines both separate; blanks vanish and duplicates collapse, order kept. */
export const splitList = (value: string): string[] => {
  const seen = new Set<string>();
  for (const part of value.split(/[\n,]/)) {
    const trimmed = part.trim();
    if (trimmed !== '') {
      seen.add(trimmed);
    }
  }
  return [...seen];
};

export interface AdvertiserChoice {
  advertiser: string;
  advertiser_domain: string;
}

/**
 * The advertiser this creative belongs to: an existing one picked from the list, or a new name
 * and domain. ONE NAME PER DOMAIN (the rule catalog/seed.ts enforces when it imports a file):
 * a domain that is already registered under another name is refused rather than renamed,
 * because the advertiser name is part of every one of its creatives' content_hash.
 */
export const readAdvertiser = (
  form: FormFields,
  context: CreativeFormContext,
  issues: CreativeFieldIssue[],
): AdvertiserChoice | null => {
  const selected = readText(form, 'advertiser_id').trim();
  if (selected !== '' && selected !== NEW_ADVERTISER_VALUE) {
    const known = context.advertisers.find((option) => option.id === selected);
    if (known === undefined) {
      issues.push(issue('advertiser_id', 'That advertiser is not in the database any more.'));
      return null;
    }
    return { advertiser: known.name, advertiser_domain: known.domain };
  }

  const name = readText(form, 'advertiser').trim();
  const domain = readText(form, 'advertiser_domain').trim().toLowerCase();
  if (name === '') {
    issues.push(issue('advertiser', 'Enter the advertiser’s name.'));
  }
  if (domain === '') {
    issues.push(issue('advertiser_domain', 'Enter the advertiser’s domain, e.g. exampledb.dev.'));
  } else if (!DOMAIN_PATTERN.test(domain)) {
    issues.push(
      issue(
        'advertiser_domain',
        'A domain only: no scheme, port or path (exampledb.dev, not https://exampledb.dev/).',
      ),
    );
  } else {
    const known = context.advertisers.find((option) => option.domain === domain);
    if (known !== undefined && known.name !== name) {
      issues.push(
        issue(
          'advertiser_domain',
          `${domain} is already registered as “${known.name}”. Choose that advertiser above, or use a different domain: one name per domain.`,
        ),
      );
    }
  }
  return name === '' || domain === '' ? null : { advertiser: name, advertiser_domain: domain };
};

/** A required (or optional) single-line field with a length limit. */
export const readField = (
  form: FormFields,
  field: CreativeField,
  label: string,
  max: number,
  issues: CreativeFieldIssue[],
  required = true,
): string => {
  const value = readText(form, field).trim();
  if (required && value === '') {
    issues.push(issue(field, `Enter the ${label}.`));
  } else if (value.length > max) {
    issues.push(issue(field, `${label} must be at most ${String(max)} characters.`));
  }
  return value;
};

export const readList = (
  form: FormFields,
  field: CreativeField,
  label: string,
  issues: CreativeFieldIssue[],
): string[] => {
  const values = splitList(readText(form, field));
  if (values.length > MAX_LIST_ITEMS) {
    issues.push(issue(field, `At most ${String(MAX_LIST_ITEMS)} ${label} entries.`));
  }
  return values;
};

export const readCategories = (form: FormFields, issues: CreativeFieldIssue[]): string[] => {
  const values = readList(form, 'target_categories', 'target category', issues);
  if (values.length === 0) {
    issues.push(
      issue(
        'target_categories',
        'Enter at least one category: a creative with none matches nothing and can never serve.',
      ),
    );
    return values;
  }
  const unknown = values.filter((value) => !isKnownTargetCategory(value));
  if (unknown.length > 0) {
    issues.push(
      issue(
        'target_categories',
        `Not in the taxonomy: ${unknown.join(', ')}. Use a category such as software.devtools.database, or a wildcard over one such as software.devtools.*`,
      ),
    );
  }
  return values;
};

export const readRegions = (form: FormFields, issues: CreativeFieldIssue[]): string[] => {
  const values = readList(form, 'target_regions', 'target region', issues).map((value) =>
    value.toUpperCase(),
  );
  const bad = values.filter((value) => !/^[A-Z]{2}$/.test(value));
  if (bad.length > 0) {
    issues.push(
      issue(
        'target_regions',
        `Not an ISO 3166-1 alpha-2 code or EU: ${bad.join(', ')}. Leave the field empty to serve every region.`,
      ),
    );
  }
  return values;
};

/** The destination. Direct creatives are redirected to it as stored, so it must be a real URL. */
export const readUrlTemplate = (form: FormFields, issues: CreativeFieldIssue[]): string => {
  const value = readField(form, 'url_template', 'destination URL', MAX_URL_LENGTH, issues);
  if (value !== '' && !isHttpUrl(value)) {
    issues.push(
      issue(
        'url_template',
        'The destination must be an absolute http(s) URL. Affiliate templates may hold placeholders such as {{program_id}}.',
      ),
    );
  }
  return value;
};

export const readEcpm = (form: FormFields, issues: CreativeFieldIssue[]): number => {
  const raw = readText(form, 'ecpm').trim();
  const value = raw === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) {
    issues.push(issue('ecpm', 'Enter the expected revenue per thousand impressions, e.g. 12.'));
    return 0;
  }
  if (value < 0) {
    issues.push(issue('ecpm', 'eCPM cannot be negative.'));
    return 0;
  }
  if (value > MAX_ECPM) {
    issues.push(issue('ecpm', `eCPM must be at most ${String(MAX_ECPM)}.`));
    return 0;
  }
  return value;
};

export interface SourceChoice {
  source: string;
  network?: string;
  program_id?: string;
}

/**
 * Source, and the two fields only an affiliate creative has. An affiliate creative MUST name
 * its network: the network decides which builder turns url_template into a tracked link, and
 * a creative without one is only servable by whichever affiliate demand entry happens to be
 * first in the policy. Direct creatives carry neither field.
 */
export const readSource = (form: FormFields, issues: CreativeFieldIssue[]): SourceChoice => {
  const source = readText(form, 'source').trim();
  if (!(CREATIVE_SOURCE_VALUES as readonly string[]).includes(source)) {
    issues.push(issue('source', `Source must be one of ${CREATIVE_SOURCE_VALUES.join(', ')}.`));
    return { source: 'direct' };
  }
  if (source !== 'affiliate') {
    return { source };
  }
  const network = readText(form, 'network').trim();
  if (network === '') {
    issues.push(issue('network', 'An affiliate creative must name its network.'));
  } else if (!AffiliateNetwork.safeParse(network).success) {
    issues.push(issue('network', `Unknown affiliate network “${network}”.`));
  }
  const programId = readText(form, 'program_id').trim();
  if (programId.length > MAX_PROGRAM_ID_LENGTH) {
    issues.push(
      issue(
        'program_id',
        `Program id must be at most ${String(MAX_PROGRAM_ID_LENGTH)} characters.`,
      ),
    );
  }
  return {
    source,
    ...(network === '' ? {} : { network }),
    ...(programId === '' ? {} : { program_id: programId }),
  };
};

export const readAppId = (
  form: FormFields,
  context: CreativeFormContext,
  issues: CreativeFieldIssue[],
): string | null => {
  const appId = readText(form, 'app_id').trim();
  if (appId === '') {
    return null;
  }
  if (!context.appIds.includes(appId)) {
    issues.push(issue('app_id', 'That app is not registered against this gateway.'));
    return null;
  }
  return appId;
};
