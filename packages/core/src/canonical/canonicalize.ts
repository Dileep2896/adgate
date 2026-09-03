/**
 * Canonical JSON as defined in docs/audit.md: keys sorted lexicographically at every level, no
 * insignificant whitespace, UTF-8, numbers in shortest round-trip form. Arrays keep their order.
 * Object properties whose value is undefined are dropped, as JSON.stringify does.
 *
 * KEY ORDER, precisely: keys are compared as sequences of UTF-16 code units, JavaScript's default
 * Array.prototype.sort on strings and what RFC 8785 (JCS) prescribes. It is NOT code point order:
 * a supplementary-plane character (an emoji, encoded as a surrogate pair 0xD800-0xDFFF) sorts
 * BEFORE any BMP character above U+D7FF (for example U+FB01), although its code point is larger.
 * Another language must sort by UTF-16 code units too (Python: key.encode('utf-16-be')); the
 * fixtures/canonical-json.json vectors pin this. The string is assembled by hand rather than
 * through JSON.stringify on a re-keyed object, because JavaScript enumerates integer-like keys
 * ("10", "2") numerically first, which would break lexicographic order. JSON.stringify is still
 * used for every scalar, so numbers come out in their shortest round-trip form and strings are
 * escaped the standard way.
 *
 * Only JSON values are accepted: plain objects, arrays, strings, finite numbers, booleans and
 * null. Anything else (Date, Map, bigint, NaN, Infinity, functions, undefined outside an object
 * property) throws, because a hash over a silently altered value would verify the wrong data.
 */
export const canonicalize = (value: unknown): string => serialize(value, '$');

const serialize = (value: unknown, path: string): string => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalize: non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item, index) => {
      if (item === undefined) {
        throw new TypeError(`canonicalize: undefined array element at ${path}[${index}]`);
      }
      return serialize(item, `${path}[${index}]`);
    });
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `canonicalize: unsupported object at ${path} (only plain objects and arrays are JSON)`,
      );
    }
    const record = value as Record<string, unknown>;
    const members: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) {
        members.push(`${JSON.stringify(key)}:${serialize(item, `${path}.${key}`)}`);
      }
    }
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`canonicalize: unsupported ${typeof value} at ${path}`);
};
