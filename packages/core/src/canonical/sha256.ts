import { createHash } from 'node:crypto';

import type { Sha256Hash } from '@adgate/schemas';

/** Lowercase hex SHA-256 of the UTF-8 encoding of `text`. */
export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/** The on-the-wire hash form used throughout the contract docs: `sha256:<hex>`. */
export const sha256Prefixed = (text: string): Sha256Hash => `sha256:${sha256Hex(text)}`;
