'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, type FormEvent, type ReactElement } from 'react';

import { messageText, type ChatMessage, type Tier } from '@/lib/chat';
import { browserEventClient } from '@/lib/events';
import { AssistantTurn } from './assistant-turn';
import { TierToggle } from './tier-toggle';

/**
 * The chat UI. Nothing in here talks to the gateway: the browser only ever calls this app's own
 * /api/chat (the answer plus the adgate decision as a separate data part) and /api/events (the
 * impression relay). The API key never leaves the server.
 */

const transport = new DefaultChatTransport<ChatMessage>({ api: '/api/chat' });

export const SUGGESTIONS = [
  'which postgres hosting should I use for a side project',
  'how do I keep my side project deploys cheap',
  'I have had a headache for three days, what should I do',
];

const IN_FLIGHT = new Set(['submitted', 'streaming']);

export const Chat = (): ReactElement => {
  const [input, setInput] = useState('');
  const [tier, setTier] = useState<Tier>('free');
  const { messages, sendMessage, status, error } = useChat<ChatMessage>({ transport });
  const busy = IN_FLIGHT.has(status);

  const ask = (text: string): void => {
    const question = text.trim();
    if (question === '' || busy) {
      return;
    }
    setInput('');
    // The tier rides along with the message and becomes `user.tier` on the evaluate request.
    void sendMessage({ text: question }, { body: { tier } });
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    ask(input);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-5 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">adgate example chat</h1>
          <p className="text-sm text-stone-500">
            Sponsored blocks are rendered after the answer, in their own labelled container,
            never inside the model&apos;s text.
          </p>
        </div>
        <TierToggle tier={tier} onChange={setTier} disabled={busy} />
      </header>

      <ul className="flex flex-1 flex-col gap-6">
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <li key={message.id} className="flex justify-end">
              <div className="max-w-2xl rounded-2xl rounded-tr-sm bg-stone-800 px-4 py-3 text-[15px] text-stone-50">
                {messageText(message)}
              </div>
            </li>
          ) : (
            <AssistantTurn
              key={message.id}
              message={message}
              client={browserEventClient}
              streaming={busy && index === messages.length - 1}
            />
          ),
        )}
      </ul>

      {error === undefined ? null : (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>
      )}

      {messages.length > 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                ask(suggestion);
              }}
              className="rounded-full bg-white px-3 py-1.5 text-xs text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="sticky bottom-4 flex gap-2">
        <input
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
          }}
          placeholder="Ask something…"
          aria-label="Message"
          className="flex-1 rounded-full bg-white px-4 py-3 text-[15px] shadow-sm ring-1 ring-stone-200 outline-none focus:ring-stone-400"
        />
        <button
          type="submit"
          disabled={busy || input.trim() === ''}
          className="rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
};
