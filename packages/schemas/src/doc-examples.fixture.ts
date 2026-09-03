import { readFileSync } from 'node:fs';

/**
 * Test fixture (not on the package index: it reads node:fs, and index-purity.test.ts pins the
 * index to zod + yaml). The JSON examples of docs/api.md and docs/audit.md are extracted at test
 * time instead of hand-copied, so an edit to a contract doc is felt by the schema tests at once.
 * Only the `...` placeholders the docs use for elided values are replaced, with values of the
 * documented format; the prefix-only ids (aud_01J..., cr_01J...) parse as they are.
 */
export const DOCS_DIR = new URL('../../../docs/', import.meta.url);

export type ContractDoc = 'api.md' | 'audit.md';

/** A well-formed stand-in for every `sha256:...` in the docs (64 lowercase hex digits). */
export const EXAMPLE_SHA256 = `sha256:${'0123456789abcdef'.repeat(4)}`;

/** A well-formed stand-in for `ed25519:base64...`: 64 bytes as padded base64, 88 characters. */
export const EXAMPLE_SIGNATURE = `ed25519:${'A'.repeat(86)}==`;

/** Replaces the elided values (`sha256:...`, `sha256:... or null`, `ed25519:base64...`). */
export const fillDocPlaceholders = (json: string): string =>
  json
    .replace(/"sha256:\.\.\.(?: or null)?"/g, JSON.stringify(EXAMPLE_SHA256))
    .replace(/"ed25519:base64\.\.\."/g, JSON.stringify(EXAMPLE_SIGNATURE));

export interface DocJsonBlock {
  /** The nearest `## ` heading above the block, '' for a block before the first heading. */
  heading: string;
  value: unknown;
}

const HEADING = /^##\s+(.+?)\s*$/;
const FENCE_OPEN = /^```json\s*$/;
const FENCE_CLOSE = /^```\s*$/;

/** Every ```json block of the doc, parsed after placeholder filling, in document order. */
export const docJsonBlocks = (doc: ContractDoc): DocJsonBlock[] => {
  const lines = readFileSync(new URL(doc, DOCS_DIR), 'utf8').split('\n');
  const blocks: DocJsonBlock[] = [];
  let heading = '';
  let open: string[] | null = null;
  for (const line of lines) {
    if (open !== null) {
      if (FENCE_CLOSE.test(line)) {
        blocks.push({ heading, value: JSON.parse(fillDocPlaceholders(open.join('\n'))) });
        open = null;
      } else {
        open.push(line);
      }
      continue;
    }
    const match = HEADING.exec(line);
    if (match?.[1] !== undefined) {
      heading = match[1];
    } else if (FENCE_OPEN.test(line)) {
      open = [];
    }
  }
  return blocks;
};

/** The ```json blocks under one `## ` heading, in document order. */
export const docJsonExamples = (doc: ContractDoc, heading: string): unknown[] =>
  docJsonBlocks(doc)
    .filter((block) => block.heading === heading)
    .map((block) => block.value);

/** Exactly `count` examples under the heading, or a clear failure naming what was found. */
export const expectDocExamples = (doc: ContractDoc, heading: string, count: number): unknown[] => {
  const examples = docJsonExamples(doc, heading);
  if (examples.length !== count) {
    throw new Error(
      `docs/${doc} "${heading}": expected ${count} json example(s), found ${examples.length}`,
    );
  }
  return examples;
};
