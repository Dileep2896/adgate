/**
 * Who the request came from, and whether that address is allowed in at all.
 *
 * EDGE SAFE ON PURPOSE. middleware.ts runs in Next's Edge runtime, so it can import this and
 * lib/rate-limit.ts and nothing else of ours: lib/env.ts touches node:fs and would fail to
 * compile into the middleware bundle. env.ts re-exports parseTrustedProxyHops from here so the
 * server side keeps one import path and there is only ever ONE definition of how much of
 * x-forwarded-for may be believed.
 *
 * Nothing here does IO, reads process.env or throws.
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * How many proxy hops in front of this process may be believed, from TRUSTED_PROXY_HOPS (an
 * integer, which wins) or TRUST_PROXY (a boolean meaning "exactly one").
 *
 * DEFAULT 0: BELIEVE NOTHING. x-forwarded-for is a request header, so a dashboard reachable
 * directly must not key its login rate limiter on it (lib/rate-limit.ts). Anything unparseable
 * is 0 as well - a typo must not silently hand an attacker a header they control.
 */
export const parseTrustedProxyHops = (
  trustProxy: string | undefined,
  hops: string | undefined,
): number => {
  const explicit = (hops ?? '').trim();
  if (explicit !== '') {
    const value = Number(explicit);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }
  return TRUTHY.has((trustProxy ?? '').trim().toLowerCase()) ? 1 : 0;
};

const IPV4_GROUP = /^\d{1,3}$/;
const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;

const parseIpv4 = (text: string): Uint8Array | null => {
  const groups = text.split('.');
  if (groups.length !== 4) {
    return null;
  }
  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    const group = groups[index] ?? '';
    if (!IPV4_GROUP.test(group)) {
      return null;
    }
    const value = Number(group);
    if (value > 255) {
      return null;
    }
    bytes[index] = value;
  }
  return bytes;
};

/** One half of an IPv6 literal (either side of `::`) as bytes, or null if it is malformed. */
const ipv6SectionBytes = (section: string): number[] | null => {
  if (section === '') {
    return [];
  }
  const groups = section.split(':');
  const bytes: number[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index] ?? '';
    if (group.includes('.')) {
      // A dotted quad is only legal as the very last group (`::ffff:203.0.113.7`).
      const embedded = index === groups.length - 1 ? parseIpv4(group) : null;
      if (embedded === null) {
        return null;
      }
      bytes.push(...embedded);
      continue;
    }
    if (!IPV6_GROUP.test(group)) {
      return null;
    }
    const value = Number.parseInt(group, 16);
    bytes.push(value >>> 8, value & 0xff);
  }
  return bytes;
};

const parseIpv6 = (text: string): Uint8Array | null => {
  // A scope id (`fe80::1%eth0`) names an interface on the sender's machine, not an address.
  const halves = (text.split('%')[0] ?? '').split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = ipv6SectionBytes(halves[0] ?? '');
  if (head === null) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === 16 ? Uint8Array.from(head) : null;
  }
  const tail = ipv6SectionBytes(halves[1] ?? '');
  if (tail === null) {
    return null;
  }
  // `::` must stand for at least one all-zero group.
  const gap = 16 - head.length - tail.length;
  if (gap < 2) {
    return null;
  }
  return Uint8Array.from([...head, ...new Array<number>(gap).fill(0), ...tail]);
};

/** ::ffff:a.b.c.d - an IPv4 client seen through a dual-stack socket. */
const isIpv4Mapped = (bytes: Uint8Array): boolean =>
  bytes.length === 16 &&
  bytes[10] === 0xff &&
  bytes[11] === 0xff &&
  bytes.subarray(0, 10).every((byte) => byte === 0);

/**
 * An IP address as bytes: 4 for IPv4, 16 for IPv6, null for anything else (including
 * clientKey()'s 'unknown'). An IPv4-mapped IPv6 address is folded back to its four bytes so
 * `203.0.113.7` in the allowlist matches a client the platform reported as `::ffff:203.0.113.7`.
 * A `[...]` wrapper and a trailing `:port` are tolerated: some proxies write the peer that way.
 */
export const parseIpAddress = (value: string): Uint8Array | null => {
  let text = value.trim();
  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    if (close === -1) {
      return null;
    }
    text = text.slice(1, close);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(text)) {
    text = text.slice(0, text.lastIndexOf(':'));
  }
  if (text === '') {
    return null;
  }
  const bytes = text.includes(':') ? parseIpv6(text) : parseIpv4(text);
  return bytes !== null && isIpv4Mapped(bytes) ? bytes.subarray(12) : bytes;
};

/** One DASHBOARD_ALLOWED_IPS entry: an address plus how many of its leading bits must match. */
export interface ClientRule {
  bytes: Uint8Array;
  bits: number;
}

export interface ClientAllowlist {
  /** The entries that parsed. An empty list refuses everything. */
  rules: ClientRule[];
  /** Entries that did not parse; they are IGNORED, never treated as "allow". */
  invalid: string[];
}

const parseRule = (entry: string): ClientRule | null => {
  const slash = entry.lastIndexOf('/');
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const bytes = parseIpAddress(address);
  if (bytes === null) {
    return null;
  }
  const width = bytes.length * 8;
  if (slash === -1) {
    return { bytes, bits: width };
  }
  const suffix = entry.slice(slash + 1).trim();
  if (!/^\d{1,3}$/.test(suffix)) {
    return null;
  }
  const bits = Number(suffix);
  return bits > width ? null : { bytes, bits };
};

/**
 * Parses DASHBOARD_ALLOWED_IPS: a comma separated list of IPv4/IPv6 addresses and CIDR ranges
 * (`203.0.113.7, 198.51.100.0/24, 2001:db8::/32`). Returns null when the variable is unset or
 * blank, which means NO allowlist and unchanged behaviour.
 *
 * FAIL CLOSED. A set-but-unusable value (every entry a typo) parses to an empty rule list, and
 * an empty rule list matches nothing: the operator gets 403 from their own desk and fixes the
 * typo, rather than believing they are protected while everyone is let in.
 */
export const parseClientAllowlist = (value: string | undefined): ClientAllowlist | null => {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) {
    return null;
  }
  const rules: ClientRule[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    const rule = parseRule(entry);
    if (rule === null) {
      invalid.push(entry);
    } else {
      rules.push(rule);
    }
  }
  return { rules, invalid };
};

const matchesRule = (client: Uint8Array, rule: ClientRule): boolean => {
  if (client.length !== rule.bytes.length) {
    return false;
  }
  const wholeBytes = rule.bits >> 3;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (client[index] !== rule.bytes[index]) {
      return false;
    }
  }
  const remainder = rule.bits & 7;
  if (remainder === 0) {
    return true;
  }
  const mask = 0xff << (8 - remainder);
  return ((client[wholeBytes] ?? 0) & mask) === ((rule.bytes[wholeBytes] ?? 0) & mask);
};

/**
 * Whether this client address is on the allowlist. `client` is whatever clientKey() decided the
 * caller is, so with TRUST_PROXY unset it is the string 'unknown' behind a proxy - which parses
 * as no address and is refused. That is deliberate: an allowlist keyed on a header nobody
 * verified would be decoration, and refusing is the safe half of the mistake.
 */
export const isClientAllowed = (client: string, allowlist: ClientAllowlist): boolean => {
  const bytes = parseIpAddress(client);
  if (bytes === null) {
    return false;
  }
  return allowlist.rules.some((rule) => matchesRule(bytes, rule));
};
