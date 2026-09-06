import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  API_KEY_ENV,
  APP_ID_PLACEHOLDER,
  BASE_URL_ENV,
  integrationSnippets,
} from './integration-snippets';

/**
 * The snippets the dashboard hands an operator have to compile in their editor, and the one
 * place in this repo where an SDK snippet is known to compile is docs/integration.md: its
 * `ts`, `tsx` and `python` blocks are type checked and imported against the real packages on
 * every run (packages/sdk/src/docs-snippets.test.ts, packages/sdk-python/tests).
 *
 * So this file does not re-check the SDK - it checks that the dashboard's copies are still
 * the guide's copies. Every line asserted below is a line the guide contains verbatim; when
 * the SDK surface changes, the guide changes, its own tests catch anything wrong, and THIS
 * test then fails until the dashboard follows. Without it the panel would quietly go on
 * teaching an API that no longer exists.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const guide = readFileSync(resolve(repoRoot, 'docs', 'integration.md'), 'utf8');

const APP_ID = 'app_01JQ7K3M8Z4W2P6R9T5X1B0YHC';

const snippets = integrationSnippets(APP_ID);
const byId = new Map(snippets.map((snippet) => [snippet.id, snippet]));
const code = (id: 'server' | 'react' | 'python'): string => byId.get(id)?.code ?? '';

/** Lines the guide must still contain for the dashboard's copy of it to be true. */
const GUIDE_LINES: Record<'server' | 'react' | 'python', string[]> = {
  server: [
    "import { createClient, type EvaluateResult } from '@adgate/sdk';",
    "import { adgateMiddleware } from '@adgate/sdk/ai';",
    "import { streamText, wrapLanguageModel } from 'ai';",
    "type ProviderModel = Parameters<typeof wrapLanguageModel>[0]['model'];",
    'middleware: adgateMiddleware(adgate, {',
    "surface: 'chat',",
    "getUser: () => ({ tier: turn.tier, region: 'US', locale: 'en-US' }),",
    'conversationId: () => turn.conversationId,',
    'turnId: () => turn.turnId,',
  ],
  react: [
    "import { AdgateMessageBoundary, SponsoredSlot, type SponsoredSlotClient } from '@adgate/sdk/react';",
    '<AdgateMessageBoundary>',
    '<div data-adgate-message="assistant">',
    '<SponsoredSlot decision={props.decision} client={props.client} />',
  ],
  python: [
    'from adgate import AsyncAdgate, Decision',
    'evaluation = asyncio.ensure_future(adgate.evaluate(request))',
    '"surface": {"type": "chat", "placement": "after_answer", "max_creatives": 1},',
    'served = decision.decision == Decision.serve and creative is not None',
    'await adgate.attest(decision.audit_id, answer, rendered=served)',
  ],
};

describe('the integration snippets', () => {
  it('offers the server, React and Python shapes, in that order', () => {
    expect(snippets.map((snippet) => snippet.id)).toEqual(['server', 'react', 'python']);
    for (const snippet of snippets) {
      expect(snippet.label.length, snippet.id).toBeGreaterThan(0);
      expect(snippet.filename.length, snippet.id).toBeGreaterThan(0);
      expect(snippet.copyLabel, snippet.id).toMatch(/^Copy .+ snippet$/);
      expect(snippet.summary.length, snippet.id).toBeGreaterThan(0);
      expect(snippet.code.trimEnd().length, snippet.id).toBeGreaterThan(200);
    }
  });

  it('fills in the app id wherever the guide has a placeholder', () => {
    expect(code('server')).toContain(`appId: '${APP_ID}'`);
    expect(code('python')).toContain(`"app_id": "${APP_ID}"`);
    for (const snippet of snippets) {
      expect(snippet.code, snippet.id).not.toContain(APP_ID_PLACEHOLDER);
    }
  });

  it('names the key as an environment variable and never inlines one', () => {
    expect(code('server')).toContain(`process.env.${API_KEY_ENV}`);
    expect(code('server')).toContain(`process.env.${BASE_URL_ENV}`);
    expect(code('python')).toContain(`os.environ["${API_KEY_ENV}"]`);
    for (const snippet of snippets) {
      // ak_<prefix>_<secret> is the shape of a real key (docs/api.md). None may appear.
      expect(snippet.code, snippet.id).not.toMatch(/\bak_[A-Za-z0-9]{4,}_/);
      expect(snippet.code, snippet.id).not.toContain('api_key="ak_');
    }
  });

  it('renders the slot outside the model output boundary, never inside it', () => {
    const react = code('react');
    const boundaryEnds = react.indexOf('</AdgateMessageBoundary>');
    const slotStarts = react.indexOf('<SponsoredSlot');
    expect(boundaryEnds).toBeGreaterThan(-1);
    expect(slotStarts).toBeGreaterThan(boundaryEnds);
  });

  for (const [id, lines] of Object.entries(GUIDE_LINES) as [
    'server' | 'react' | 'python',
    string[],
  ][]) {
    it(`stays in step with docs/integration.md: ${id}`, () => {
      for (const line of lines) {
        expect(guide, `docs/integration.md no longer contains: ${line}`).toContain(line);
        expect(code(id), `the ${id} snippet no longer contains: ${line}`).toContain(line);
      }
    });
  }
});
