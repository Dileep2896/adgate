import type { EvaluateRequest } from '@adgate/schemas';

/**
 * Turns the request's messages (or context_summary) into the one string both classifier stages
 * and the cache key work on. docs/api.md: servers truncate to the last 4 messages and 4,000
 * characters before classification. Messages are rendered as "role: content" lines, newest
 * last, so the LLM sees who said what; the tail of the conversation is kept because the
 * newest turn carries the intent. The gateway calls this too, so the same text is hashed,
 * classified and (when policy.privacy.store_raw_text is true) stored.
 */
export type PrepareTextInput = Pick<EvaluateRequest, 'messages' | 'context_summary'>;

export interface PrepareTextOptions {
  /** Keep this many messages from the end of the list. */
  maxMessages: number;
  /** Keep this many characters (Unicode code points) from the end of the joined text. */
  maxChars: number;
}

export const DEFAULT_PREPARE_OPTIONS: Readonly<PrepareTextOptions> = {
  maxMessages: 4,
  maxChars: 4000,
};

/** The last `maxChars` code points, so a surrogate pair is never split. */
const lastChars = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) {
    return text;
  }
  const points = Array.from(text);
  return points.length <= maxChars ? text : points.slice(-maxChars).join('');
};

export const prepareText = (
  input: PrepareTextInput,
  options: Readonly<PrepareTextOptions> = DEFAULT_PREPARE_OPTIONS,
): string => {
  const messages = input.messages ?? [];
  if (messages.length > 0 && options.maxMessages > 0) {
    const lines = messages
      .slice(-options.maxMessages)
      .map((message) => `${message.role}: ${message.content}`);
    return lastChars(lines.join('\n'), options.maxChars);
  }
  return lastChars(input.context_summary ?? '', options.maxChars);
};
