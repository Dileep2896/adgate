import type { EvaluateRequest, Message } from '@adgate/schemas';

/**
 * Turns the request's messages (or context_summary) into the strings the classifier stages and
 * the cache key work on. docs/api.md: servers truncate to the last 4 messages and 4,000
 * characters before classification. Only user and assistant turns are classified: system
 * prompts belong to the app and tool output is machine text, so neither is read, hashed or
 * stored, and neither can steer the classifier. The LLM gets "role: content" lines (newest
 * last) so it sees who said what; the rules stage gets the bare content so a role token can
 * never match a phrase. The gateway calls this too, so the same `text` is hashed, classified
 * and (only when policy.privacy.store_raw_text is true) stored.
 */
export type PrepareTextInput = Pick<EvaluateRequest, 'messages' | 'context_summary'>;

export interface PrepareTextOptions {
  /** Keep this many classified messages from the end of the list. */
  maxMessages: number;
  /** Keep this many characters (Unicode code points) from the end of each joined text. */
  maxChars: number;
}

export interface PreparedText {
  /** "role: content" lines, newest last: what the LLM reads and what the cache key hashes. */
  text: string;
  /** The same messages' content only, one per line: what the rules stage matches. */
  rulesText: string;
}

export const DEFAULT_PREPARE_OPTIONS: Readonly<PrepareTextOptions> = {
  maxMessages: 4,
  maxChars: 4000,
};

/** The roles the classifier reads. */
export const CLASSIFIED_ROLES: ReadonlySet<Message['role']> = new Set(['user', 'assistant']);

/** The last `maxChars` code points, so a surrogate pair is never split. */
const lastChars = (text: string, maxChars: number): string => {
  if (maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  // A code point spans at most two UTF-16 units, so the last maxChars code points lie inside
  // the last 2 * maxChars units; slicing first keeps a huge message from becoming a huge array.
  // If the slice starts on the low half of a pair, that half is one extra "point" at the front
  // and is dropped by the final slice.
  const tail = text.slice(-maxChars * 2);
  const points = Array.from(tail);
  return points.length <= maxChars ? tail : points.slice(-maxChars).join('');
};

export const prepareText = (
  input: PrepareTextInput,
  options: Readonly<PrepareTextOptions> = DEFAULT_PREPARE_OPTIONS,
): PreparedText => {
  const messages = (input.messages ?? []).filter((message) => CLASSIFIED_ROLES.has(message.role));
  if (messages.length > 0 && options.maxMessages > 0) {
    const kept = messages.slice(-options.maxMessages);
    return {
      text: lastChars(
        kept.map((message) => `${message.role}: ${message.content}`).join('\n'),
        options.maxChars,
      ),
      rulesText: lastChars(kept.map((message) => message.content).join('\n'), options.maxChars),
    };
  }
  const summary = lastChars(input.context_summary ?? '', options.maxChars);
  return { text: summary, rulesText: summary };
};
