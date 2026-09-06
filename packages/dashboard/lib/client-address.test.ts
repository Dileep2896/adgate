import { describe, expect, it } from 'vitest';

import {
  isClientAllowed,
  parseClientAllowlist,
  parseIpAddress,
  parseTrustedProxyHops,
} from './client-address';

/**
 * DASHBOARD_ALLOWED_IPS decides who may reach the dashboard AT ALL, so the two ways it can be
 * wrong are the two things worth testing hardest: letting an address in that is outside the
 * list, and treating a value it could not parse as permission.
 */

const allowlist = (value: string) => {
  const parsed = parseClientAllowlist(value);
  if (parsed === null) {
    throw new Error(`expected an allowlist from "${value}"`);
  }
  return parsed;
};

const allows = (value: string, client: string): boolean =>
  isClientAllowed(client, allowlist(value));

describe('parseIpAddress', () => {
  it('reads IPv4', () => {
    expect([...(parseIpAddress('203.0.113.7') ?? [])]).toEqual([203, 0, 113, 7]);
    expect([...(parseIpAddress('  0.0.0.0 ') ?? [])]).toEqual([0, 0, 0, 0]);
    // Some proxies write the peer with its source port.
    expect([...(parseIpAddress('203.0.113.7:54321') ?? [])]).toEqual([203, 0, 113, 7]);
  });

  it('reads IPv6, compressed, bracketed and with a scope', () => {
    const loopback = parseIpAddress('::1');
    expect(loopback).toHaveLength(16);
    expect([...(loopback ?? [])].slice(-2)).toEqual([0, 1]);
    expect(parseIpAddress('[2001:db8::1]')).toEqual(parseIpAddress('2001:db8::1'));
    expect(parseIpAddress('[2001:db8::1]:443')).toEqual(parseIpAddress('2001:db8::1'));
    expect(parseIpAddress('fe80::1%eth0')).toEqual(parseIpAddress('fe80::1'));
    expect(parseIpAddress('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual(
      parseIpAddress('2001:db8::1'),
    );
  });

  it('folds an IPv4-mapped IPv6 address back to its four bytes', () => {
    expect(parseIpAddress('::ffff:203.0.113.7')).toEqual(parseIpAddress('203.0.113.7'));
    // ::1 is NOT an IPv4 address wearing a hat.
    expect(parseIpAddress('::1')).toHaveLength(16);
  });

  it('refuses anything that is not an address', () => {
    for (const value of [
      '',
      '   ',
      'unknown',
      'localhost',
      '203.0.113',
      '203.0.113.7.8',
      '203.0.113.256',
      '203.0.113.x',
      '2001:db8::1::2',
      '2001:db8:::1',
      'gggg::1',
      '1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7:8:9',
      '[2001:db8::1',
      '1.2.3.4/24',
    ]) {
      expect(parseIpAddress(value), value).toBeNull();
    }
  });
});

describe('parseClientAllowlist', () => {
  it('is null when the variable is unset or blank, which means no allowlist at all', () => {
    for (const value of [undefined, '', '   ', ' , , ']) {
      expect(parseClientAllowlist(value), String(value)).toBeNull();
    }
  });

  it('reads addresses and CIDR ranges, in either family, ignoring spacing', () => {
    const parsed = allowlist(' 203.0.113.7 , 198.51.100.0/24 ,2001:db8::/32 ');
    expect(parsed.rules.map((rule) => rule.bits)).toEqual([32, 24, 32]);
    expect(parsed.invalid).toEqual([]);
  });

  it('drops an entry it cannot read and never treats it as permission', () => {
    const parsed = allowlist('203.0.113.7, not-an-ip, 198.51.100.0/33, 10.0.0.0/x');
    expect(parsed.invalid).toEqual(['not-an-ip', '198.51.100.0/33', '10.0.0.0/x']);
    expect(isClientAllowed('203.0.113.7', parsed)).toBe(true);
    expect(isClientAllowed('198.51.100.4', parsed)).toBe(false);
  });

  it('refuses everyone when the value is set but every entry is a typo', () => {
    const parsed = allowlist('not-an-ip, also-not-an-ip');
    expect(parsed.rules).toEqual([]);
    expect(isClientAllowed('203.0.113.7', parsed)).toBe(false);
  });
});

describe('isClientAllowed', () => {
  it('matches a single address exactly', () => {
    expect(allows('203.0.113.7', '203.0.113.7')).toBe(true);
    expect(allows('203.0.113.7', '203.0.113.8')).toBe(false);
    expect(allows('203.0.113.7', '203.0.113.70')).toBe(false);
  });

  it('matches a CIDR range on its boundaries, whole bytes and part bytes', () => {
    expect(allows('198.51.100.0/24', '198.51.100.0')).toBe(true);
    expect(allows('198.51.100.0/24', '198.51.100.255')).toBe(true);
    expect(allows('198.51.100.0/24', '198.51.101.0')).toBe(false);
    // /28 splits a byte: .0-.15 in, .16 out.
    expect(allows('198.51.100.0/28', '198.51.100.15')).toBe(true);
    expect(allows('198.51.100.0/28', '198.51.100.16')).toBe(false);
    // /0 is "everyone", and an operator who writes it means it.
    expect(allows('0.0.0.0/0', '203.0.113.7')).toBe(true);
  });

  it('matches IPv6 ranges and keeps the two families apart', () => {
    expect(allows('2001:db8::/32', '2001:db8:1234::5')).toBe(true);
    expect(allows('2001:db8::/32', '2001:db9::5')).toBe(false);
    expect(allows('2001:db8::/32', '203.0.113.7')).toBe(false);
    expect(allows('203.0.113.7', '::ffff:203.0.113.7')).toBe(true);
    expect(allows('::1', '127.0.0.1')).toBe(false);
  });

  it("refuses clientKey()'s 'unknown', which is what an untrusted proxy produces", () => {
    // Documented consequence: with TRUST_PROXY unset behind a proxy the allowlist refuses
    // everything, so a Vercel deployment using it must set TRUST_PROXY=true.
    expect(allows('0.0.0.0/0', 'unknown')).toBe(false);
    expect(allows('203.0.113.7', '')).toBe(false);
  });
});

/** Moved here from lib/env.ts so middleware can use it; env.test.ts still covers it too. */
describe('parseTrustedProxyHops', () => {
  it('is the same function the server side reads', () => {
    expect(parseTrustedProxyHops('true', undefined)).toBe(1);
    expect(parseTrustedProxyHops(undefined, '2')).toBe(2);
    expect(parseTrustedProxyHops(undefined, undefined)).toBe(0);
  });
});
