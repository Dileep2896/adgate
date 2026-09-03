import { randomBytes } from 'node:crypto';

/**
 * ULIDs (CLAUDE.md: IDs are ULIDs with a type prefix). 26 Crockford base32 characters: 10 for
 * a 48-bit millisecond timestamp, 16 for 80 random bits. Time and randomness are injectable so
 * tests get deterministic ids; the defaults are Date.now and node:crypto randomBytes.
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_BYTES = 10;
const RANDOM_LENGTH = 16;

export const ULID_LENGTH = TIME_LENGTH + RANDOM_LENGTH;
/** Largest timestamp a ULID can carry: 2^48 - 1 milliseconds since the epoch. */
export const ULID_TIME_MAX = 281474976710655;
/**
 * 26 Crockford base32 characters (no I, L, O, U). The first character carries the top 2 bits of
 * the 48-bit timestamp inside a 5-bit digit, so it is at most '7' (ULID_TIME_MAX encodes as
 * 7ZZZZZZZZZ): anything above would overflow the timestamp and is not a ULID.
 */
export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export interface UlidOptions {
  /** Clock in milliseconds since the epoch. Defaults to Date.now. */
  now?: (() => number) | undefined;
  /** Source of `length` random bytes. Defaults to node:crypto randomBytes. */
  random?: ((length: number) => Uint8Array) | undefined;
}

export const encodeUlidTime = (timeMs: number): string => {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > ULID_TIME_MAX) {
    throw new RangeError(`ULID time out of range: ${String(timeMs)}`);
  }
  let remaining = timeMs;
  const chars = new Array<string>(TIME_LENGTH);
  for (let index = TIME_LENGTH - 1; index >= 0; index -= 1) {
    chars[index] = ENCODING[remaining % 32] ?? '0';
    remaining = Math.floor(remaining / 32);
  }
  return chars.join('');
};

export const encodeUlidRandom = (bytes: Uint8Array): string => {
  if (bytes.length !== RANDOM_BYTES) {
    throw new RangeError(`ULID randomness must be ${RANDOM_BYTES} bytes, got ${bytes.length}`);
  }
  let out = '';
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = ((accumulator << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ENCODING[(accumulator >>> bits) & 31];
    }
  }
  return out;
};

/** The millisecond timestamp encoded in a ULID (the prefix, if any, must be stripped first). */
export const ulidTime = (id: string): number => {
  if (!ULID_PATTERN.test(id)) {
    throw new RangeError('not a ULID');
  }
  let time = 0;
  for (const char of id.slice(0, TIME_LENGTH)) {
    time = time * 32 + ENCODING.indexOf(char);
  }
  return time;
};

export const isUlid = (value: string): boolean => ULID_PATTERN.test(value);

export const ulid = (options: UlidOptions = {}): string => {
  const now = options.now ?? Date.now;
  const random = options.random ?? ((length: number) => randomBytes(length));
  return encodeUlidTime(now()) + encodeUlidRandom(random(RANDOM_BYTES));
};

/** `<prefix><ulid>`, e.g. prefixedUlid('cr_') for a creative id. */
export const prefixedUlid = (prefix: string, options?: UlidOptions): string =>
  `${prefix}${ulid(options)}`;
