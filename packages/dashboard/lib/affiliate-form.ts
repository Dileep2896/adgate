import { AffiliateConfig, AMAZON_MARKETPLACES } from '@adgate/schemas';

import type { FormFields } from './app-form';
import { readText } from './app-form';
import {
  type AffiliateFieldIssue,
  type AffiliateFormValues,
  EMPTY_AFFILIATE_VALUES,
} from './affiliate-issue';

/**
 * The /apps/[id] affiliate form, parsed. PURE: no database, no React, so "an invalid field writes
 * NOTHING" is provable without either (lib/affiliate-save.ts is the port that proves it).
 *
 * THE RULE THIS ENCODES, and it is the one that costs people money: a network entry exists or it
 * does not. PartnerStack and impact.com both need a program id; a campaign id without a program id
 * is meaningless, and Amazon's tag is per storefront. Leaving every field of a network blank
 * removes that network - which is the honest way to spell "I do not use it" - and an entry that is
 * half filled in is refused rather than stored, because a half-filled entry is exactly what makes
 * an adapter answer `affiliate_not_configured` while the operator believes it is configured.
 */

const issue = (field: AffiliateFieldIssue['field'], message: string): AffiliateFieldIssue => ({
  field,
  message,
});

/** Reads the five inputs as typed, trimmed. Never throws; a missing field is ''. */
export const readAffiliateFormValues = (form: FormFields): AffiliateFormValues => ({
  partnerstackProgramId: readText(form, 'partnerstack_program_id').trim(),
  impactProgramId: readText(form, 'impact_program_id').trim(),
  impactCampaignId: readText(form, 'impact_campaign_id').trim(),
  amazonTag: readText(form, 'amazon_tag').trim(),
  amazonMarketplace: readText(form, 'amazon_marketplace').trim(),
});

export type AffiliateParseResult =
  { ok: true; config: AffiliateConfig } | { ok: false; issues: AffiliateFieldIssue[] };

/**
 * Values to a validated AffiliateConfig. The contract schema has the final say - it is strict, so
 * it also catches anything this function forgot - but the checks below exist so a mistake lands on
 * the input that caused it rather than as one schema message about the whole object.
 */
export const parseAffiliateValues = (values: AffiliateFormValues): AffiliateParseResult => {
  const issues: AffiliateFieldIssue[] = [];
  const config: Record<string, unknown> = {};

  if (values.partnerstackProgramId !== '') {
    config['partnerstack'] = { program_id: values.partnerstackProgramId };
  }

  if (values.impactProgramId !== '') {
    config['impact'] = {
      program_id: values.impactProgramId,
      ...(values.impactCampaignId === '' ? {} : { campaign_id: values.impactCampaignId }),
    };
  } else if (values.impactCampaignId !== '') {
    issues.push(
      issue(
        'impact_program_id',
        'A campaign id needs the impact.com program id it belongs to. Add the program id, or clear the campaign id to switch impact.com off.',
      ),
    );
  }

  if (values.amazonTag !== '') {
    if (
      values.amazonMarketplace !== '' &&
      !(AMAZON_MARKETPLACES as readonly string[]).includes(values.amazonMarketplace)
    ) {
      issues.push(issue('amazon_marketplace', 'Choose one of the listed Amazon storefronts.'));
    }
    config['amazon'] = {
      tag: values.amazonTag,
      ...(values.amazonMarketplace === '' ? {} : { marketplace: values.amazonMarketplace }),
    };
  } else if (values.amazonMarketplace !== '') {
    issues.push(
      issue(
        'amazon_tag',
        'A storefront needs the Associates tag it applies to. Add the tag, or set the storefront back to "Any" to switch Amazon off.',
      ),
    );
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const parsed = AffiliateConfig.safeParse(config);
  if (!parsed.success) {
    // The backstop. Every path above should already have caught it, so this is a schema change
    // this module has not been taught about; report it on the form rather than throwing.
    return {
      ok: false,
      issues: parsed.error.issues.map((problem) =>
        issue('form', `${problem.path.map(String).join('.') || 'affiliate'}: ${problem.message}`),
      ),
    };
  }
  return { ok: true, config: parsed.data };
};

export const parseAffiliateForm = (form: FormFields): AffiliateParseResult =>
  parseAffiliateValues(readAffiliateFormValues(form));

/** A stored config as the form's inputs hold it: absent entries are empty strings. */
export const affiliateFormValues = (
  config: AffiliateConfig | null | undefined,
): AffiliateFormValues => {
  if (config === null || config === undefined) {
    return EMPTY_AFFILIATE_VALUES;
  }
  return {
    partnerstackProgramId: config.partnerstack?.program_id ?? '',
    impactProgramId: config.impact?.program_id ?? '',
    impactCampaignId: config.impact?.campaign_id ?? '',
    amazonTag: config.amazon?.tag ?? '',
    amazonMarketplace: config.amazon?.marketplace ?? '',
  };
};
