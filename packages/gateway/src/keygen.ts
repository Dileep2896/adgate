import { type GeneratedKeypair, generateKeypair } from '@adgateio/core';

import { isMainModule } from './cli.js';

/**
 * `pnpm --filter @adgateio/gateway keygen [--key-id k_...]`: prints a fresh Ed25519 signing key
 * pair as the three .env lines the gateway reads (docs/audit.md, .env.example). It writes no
 * files and touches no environment; the operator pastes the output into .env (git ignored).
 * When rotating, keep the previous entries in ADGATE_PUBLIC_KEYS_JSON: old public keys remain
 * available for verification forever.
 */

export interface KeygenArgs {
  keyId?: string | undefined;
}

const USAGE = 'usage: keygen [--key-id <k_YYYY_MM>]';

export const parseKeygenArgs = (argv: readonly string[]): KeygenArgs => {
  const args: KeygenArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--key-id') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(USAGE);
      }
      args.keyId = value;
      index += 1;
    } else if (arg.startsWith('--key-id=')) {
      args.keyId = arg.slice('--key-id='.length);
    } else {
      throw new Error(USAGE);
    }
  }
  return args;
};

/** A PEM as a double-quoted .env value: Node's .env parser turns the \n escapes back into newlines. */
export const escapeNewlines = (value: string): string => value.replace(/\n/g, '\\n');

export const renderKeygenOutput = (pair: GeneratedKeypair, now: Date = new Date()): string =>
  [
    `# adgate signing key generated ${now.toISOString()}. Paste into .env (git ignored). Never commit it.`,
    '# Rotating? Keep the old entries in ADGATE_PUBLIC_KEYS_JSON next to this one.',
    `ADGATE_SIGNING_KEY_ID=${pair.key_id}`,
    `ADGATE_SIGNING_KEY_PEM="${escapeNewlines(pair.private_pem)}"`,
    `ADGATE_PUBLIC_KEYS_JSON=${JSON.stringify({ [pair.key_id]: pair.public_pem })}`,
    '',
  ].join('\n');

export const generateKeygenOutput = (args: KeygenArgs): string =>
  renderKeygenOutput(generateKeypair({ keyId: args.keyId }));

if (isMainModule(import.meta.url)) {
  try {
    process.stdout.write(generateKeygenOutput(parseKeygenArgs(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
