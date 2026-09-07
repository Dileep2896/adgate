import { createClient, type AdgateClient } from '@adgateio/sdk';

/**
 * The server half of the integration. This module must never be imported from a client
 * component: ADGATE_API_KEY is a secret, and the browser only ever talks to this app's own
 * routes (/api/chat and /api/events), never to the gateway.
 */

export const DEFAULT_GATEWAY_URL = 'http://localhost:8787';

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(
      `${name} is not set. Copy .env.local.example to .env.local and fill it in (README, step 3).`,
    );
    this.name = 'MissingEnvError';
  }
}

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    throw new MissingEnvError(name);
  }
  return value;
};

let cached: AdgateClient | null = null;

/**
 * One client per process, built lazily so `next build` never needs the key. The client never
 * throws from evaluate/attest/track: any gateway problem comes back as a suppress decision.
 */
export const adgateClient = (): AdgateClient => {
  if (cached === null) {
    cached = createClient({
      apiKey: required('ADGATE_API_KEY'),
      baseUrl: process.env.ADGATE_BASE_URL?.trim() || DEFAULT_GATEWAY_URL,
      logger: {
        warn: (message, data) => {
          console.warn(`[adgate] ${message}`, data ?? {});
        },
      },
    });
  }
  return cached;
};

export const adgateAppId = (): string => required('ADGATE_APP_ID');
