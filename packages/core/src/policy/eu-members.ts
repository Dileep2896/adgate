/**
 * ISO 3166-1 alpha-2 codes of the 27 EU member states: what the token EU in policy.regions.allow
 * expands to (docs/policy.md). Sorted; Greece is GR (ISO), not EL (Eurostat). Update this list
 * only when the union's membership changes.
 */
export const EU_MEMBER_STATES = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
] as const;
export type EuMemberState = (typeof EU_MEMBER_STATES)[number];

export const isEuMemberState = (region: string): region is EuMemberState =>
  (EU_MEMBER_STATES as readonly string[]).includes(region);
