/**
 * Reading text out of the AI SDK's prompt, content and stream-part shapes.
 *
 * Everything here takes `unknown` and answers structurally, on purpose: the shapes are stable
 * across AI SDK majors (`{ role, content }` messages, `{ type: 'text', text }` parts,
 * `{ type: 'text-delta', delta }` chunks) while their TypeScript names are not, and a middleware
 * that throws on an unexpected shape would break the host app's generation. Nothing is logged
 * or stored here; the extracted text goes to the gateway for classification and, for the answer,
 * only its sha256 ever leaves the process.
 */
export const TEXT_PART_TYPE = 'text';
export const TEXT_DELTA_PART_TYPE = 'text-delta';
export const FINISH_PART_TYPE = 'finish';
const USER_ROLE = 'user';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

/** The `type: 'text'` parts of one message's content. A plain string content is the text. */
const textPartsOf = (content: unknown, separator: string): string => {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const texts: string[] = [];
  for (const part of content as unknown[]) {
    if (isRecord(part) && part['type'] === TEXT_PART_TYPE) {
      const text = part['text'];
      if (typeof text === 'string') {
        texts.push(text);
      }
    }
  }
  return texts.join(separator);
};

/**
 * The text of the LAST `role: 'user'` message of a prompt, which is what the turn is classified
 * on. System prompts belong to the app and tool output is machine text, so neither is read: this
 * mirrors packages/core's CLASSIFIED_ROLES, and it keeps an injected tool result from steering
 * the classifier. File and image parts are skipped; several text parts are joined with newlines,
 * the same way core joins messages. Returns '' when there is no user message.
 */
export const latestUserText = (prompt: unknown): string => {
  if (!Array.isArray(prompt)) {
    return '';
  }
  const messages = prompt as unknown[];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message['role'] === USER_ROLE) {
      return textPartsOf(message['content'], '\n').trim();
    }
  }
  return '';
};

/**
 * The answer text of a doGenerate result: its `type: 'text'` content parts concatenated, byte for
 * byte the same string the AI SDK exposes as `result.text`, so the attested hash is the hash of
 * the answer the user saw.
 */
export const generatedText = (content: unknown): string => textPartsOf(content, '');

/** The delta of one `text-delta` stream part, or null for every other part. */
export const textDeltaOf = (part: unknown): string | null => {
  if (!isRecord(part) || part['type'] !== TEXT_DELTA_PART_TYPE) {
    return null;
  }
  // `delta` since AI SDK v5; `textDelta` was the v4 name and costs one line to keep working.
  const delta = part['delta'] ?? part['textDelta'];
  return typeof delta === 'string' ? delta : null;
};

/** Whether this is the terminal `finish` part, the one that may carry the decision. */
export const isFinishPart = (part: unknown): boolean =>
  isRecord(part) && part['type'] === FINISH_PART_TYPE;
