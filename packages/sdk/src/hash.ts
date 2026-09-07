/**
 * SHA-256 through WebCrypto (globalThis.crypto.subtle), which Node 20 and every browser
 * provide, so this entry needs no node built-in. Output is the contract's on-the-wire form
 * `sha256:<64 lowercase hex digits>`, byte-identical to @adgateio/core's sha256Prefixed over the
 * UTF-8 encoding of the text (hash.test.ts checks it against node:crypto).
 */
export const SHA256_PREFIX = 'sha256:';

const toHex = (bytes: Uint8Array): string => {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
};

/** `sha256:<hex>` of the UTF-8 bytes of `text`. Rejects only when WebCrypto is unavailable. */
export const hashModelOutput = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `${SHA256_PREFIX}${toHex(new Uint8Array(digest))}`;
};

/**
 * prompt_version of the classification the client synthesises when the gateway never answered.
 * Classification requires a non-empty prompt_version and every real one is a sha256 of a prompt
 * or rule set, so this is the sha256 of a fixed seed string: it satisfies the schema and is
 * recognisable in dashboards as "the SDK failed closed, the gateway did not classify".
 */
export const CLIENT_FAILURE_PROMPT_SEED = 'adgate-sdk-client-failure';
export const CLIENT_FAILURE_PROMPT_VERSION =
  'sha256:679b29a0864703385ac8b4ec9b3614e1fcd32dbc33b09c69a5227a992c88ac96';
