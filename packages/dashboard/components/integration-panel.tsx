'use client';

import { type ReactNode, useRef, useState } from 'react';

import { CopyButton } from '@/components/copy-button';
import { DocRef } from '@/components/doc-ref';
import {
  API_KEY_ENV,
  BASE_URL_ENV,
  type IntegrationSnippetId,
  integrationSnippets,
} from '@/lib/integration-snippets';

/**
 * Connect your app: the three snippets that wire a chat UI to this gateway, with this app's
 * real id already in them, behind a segmented control.
 *
 * THE KEY IS NEVER HERE. Every snippet names ADGATE_API_KEY; the secret itself is readable
 * exactly once, on the screen that mints it, and this panel is deliberately safe to leave on
 * a page an operator reloads. The snippets themselves come from docs/integration.md, which
 * is compile checked on every run (lib/integration-snippets.ts).
 *
 * Client side for the tabs and the copy button. It imports lib/integration-snippets.ts and
 * lib/doc-links.ts, both of which have no imports of their own, so nothing from
 * @adgate/core - zod, the policy schema, the YAML parser - can reach the browser through it.
 */

export interface IntegrationPanelProps {
  appId: string;
  /** Under the heading. The app page uses it for the live "has a turn arrived yet" line. */
  status?: ReactNode;
  /** Section heading. The confirmation screen and the app page word it differently. */
  title?: string;
  lede?: ReactNode;
}

export const IntegrationPanel = ({
  appId,
  status,
  title = 'Connect your app',
  lede,
}: IntegrationPanelProps) => {
  const snippets = integrationSnippets(appId);
  const [selected, setSelected] = useState<IntegrationSnippetId>('server');
  const tabs = useRef<HTMLDivElement>(null);
  const active = snippets.find((snippet) => snippet.id === selected) ?? snippets[0];

  if (active === undefined) {
    return null;
  }

  /** Left and Right walk the strip, Home and End jump to its ends. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) {
      return;
    }
    event.preventDefault();
    const index = snippets.findIndex((snippet) => snippet.id === selected);
    const last = snippets.length - 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowLeft'
            ? (index + last) % snippets.length
            : (index + 1) % snippets.length;
    const target = snippets[next];
    if (target === undefined) {
      return;
    }
    setSelected(target.id);
    tabs.current?.querySelector<HTMLButtonElement>(`[data-tab="${target.id}"]`)?.focus();
  };

  return (
    <section data-testid="integration-panel" className="space-y-3">
      <div className="ag-section-head">
        <h2 className="ag-section-title">{title}</h2>
        <p className="ag-section-hint">
          App id <span className="ag-mono-2xs">{appId}</span>
        </p>
      </div>

      {lede === undefined ? null : <p className="ag-prose">{lede}</p>}
      {status}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          ref={tabs}
          role="tablist"
          aria-label="Integration snippet"
          className="ag-tabs"
          onKeyDown={onKeyDown}
        >
          {snippets.map((snippet) => (
            <button
              key={snippet.id}
              type="button"
              role="tab"
              id={`integration-tab-${snippet.id}`}
              data-tab={snippet.id}
              data-testid={`integration-tab-${snippet.id}`}
              aria-selected={snippet.id === selected}
              aria-controls={`integration-panel-${snippet.id}`}
              tabIndex={snippet.id === selected ? 0 : -1}
              className="ag-tab"
              onClick={() => {
                setSelected(snippet.id);
              }}
            >
              {snippet.label}
            </button>
          ))}
        </div>
        <CopyButton value={active.code} label={active.copyLabel} testId="copy-snippet" />
      </div>

      <div
        role="tabpanel"
        id={`integration-panel-${active.id}`}
        aria-labelledby={`integration-tab-${active.id}`}
        tabIndex={0}
        className="space-y-2"
      >
        <p className="ag-prose">{active.summary}</p>
        <div className="ag-well">
          <p className="ag-well-bar">
            <span className="ag-well-file">{active.filename}</span>
            <span>{active.id === 'python' ? 'python 3.10+' : 'typescript'} · app id filled in</span>
          </p>
          <pre data-testid="integration-code">
            <code>{active.code}</code>
          </pre>
        </div>
      </div>

      <p className="ag-hint">
        Set <span className="ag-code">{API_KEY_ENV}</span> to the app-role key on your server (and{' '}
        <span className="ag-code">{BASE_URL_ENV}</span> if this gateway is not on localhost:8787).
        The key is a server-side secret and must never reach a browser. The long form of all three
        shapes, plus agent loops and CLIs, is in <DocRef doc="integration" />; running the gateway
        itself is <DocRef doc="deploy" />.
      </p>
    </section>
  );
};
