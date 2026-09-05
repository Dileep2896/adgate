/**
 * The handful of markdown primitives docs/api-reference.md is built from (openapi/reference.ts).
 * Nothing here knows about OpenAPI; it only makes text safe to put in a table.
 */

/** Squashes whitespace and escapes the pipe so any text can sit in a markdown table cell. */
export const cell = (text: string): string =>
  text.replace(/\s+/gu, ' ').trim().replace(/\|/gu, '\\|');

/** One table row, every cell escaped. */
export const tableRow = (values: readonly string[]): string =>
  `| ${values.map(cell).join(' | ')} |`;

/** A header row, its separator, and one row per entry. */
export const table = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string[] => [
  tableRow(headers),
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map(tableRow),
];

/** Inline code span. */
export const code = (text: string): string => `\`${text}\``;

/** A fenced JSON block of `value`, pretty printed. */
export const jsonBlock = (value: unknown): string[] => [
  '```json',
  JSON.stringify(value, null, 2),
  '```',
];
