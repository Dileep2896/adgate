import { describe, expect, it } from 'vitest';

import { parseFlags, UsageError } from './args.js';
import { parseCreateAppArgs } from './create-app.js';
import { parseCreateKeyArgs } from './create-key.js';
import { parseSeedCreativesArgs } from './seed-creatives.js';

describe('parseFlags', () => {
  const spec = { name: 'string', force: 'boolean' } as const;

  it('reads --flag value, --flag=value and boolean flags', () => {
    expect(parseFlags(['--name', 'My App', '--force'], spec)).toEqual({
      help: false,
      flags: { name: 'My App', force: true },
    });
    expect(parseFlags(['--name=My App'], spec)).toEqual({
      help: false,
      flags: { name: 'My App' },
    });
  });

  it('ignores the bare -- that pnpm run forwards to scripts', () => {
    expect(parseFlags(['--', '--name', 'x'], spec)).toEqual({ help: false, flags: { name: 'x' } });
    expect(parseFlags(['--', '--help'], spec).help).toBe(true);
  });

  it('recognises --help anywhere and stops parsing', () => {
    expect(parseFlags(['--help'], spec).help).toBe(true);
    expect(parseFlags(['--name', 'x', '--help'], spec).help).toBe(true);
    expect(parseFlags(['-h'], spec).help).toBe(true);
  });

  it('rejects unknown flags, missing values, repeated flags and positional arguments', () => {
    expect(() => parseFlags(['--bogus'], spec)).toThrow(UsageError);
    expect(() => parseFlags(['--name'], spec)).toThrow(/--name requires a value/);
    expect(() => parseFlags(['--name', '--force'], spec)).toThrow(/--name requires a value/);
    expect(() => parseFlags(['--force=yes'], spec)).toThrow(/--force takes no value/);
    expect(() => parseFlags(['--name', 'a', '--name', 'b'], spec)).toThrow(/--name given twice/);
    expect(() => parseFlags(['stray'], spec)).toThrow(/unexpected argument/);
  });
});

describe('create-app arguments', () => {
  it('requires --name and accepts an optional --policy path', () => {
    expect(parseCreateAppArgs(['--name', 'Chat'])).toEqual({ help: false, name: 'Chat' });
    expect(parseCreateAppArgs(['--name=Chat', '--policy', 'p.yaml'])).toEqual({
      help: false,
      name: 'Chat',
      policyPath: 'p.yaml',
    });
    expect(parseCreateAppArgs(['--help'])).toEqual({ help: true });
    expect(() => parseCreateAppArgs([])).toThrow(/--name/);
    expect(() => parseCreateAppArgs(['--name', '  '])).toThrow(/--name/);
  });
});

describe('create-key arguments', () => {
  it('requires --app and --role, and --advertiser exactly for advertiser_read', () => {
    expect(parseCreateKeyArgs(['--app', 'app_1', '--role', 'app'])).toEqual({
      help: false,
      appId: 'app_1',
      role: 'app',
      advertiserId: null,
    });
    expect(
      parseCreateKeyArgs(['--app=app_1', '--role=advertiser_read', '--advertiser=adv_1']),
    ).toEqual({ help: false, appId: 'app_1', role: 'advertiser_read', advertiserId: 'adv_1' });
    expect(parseCreateKeyArgs(['--help'])).toEqual({ help: true });
    expect(() => parseCreateKeyArgs(['--role', 'app'])).toThrow(/--app/);
    expect(() => parseCreateKeyArgs(['--app', 'app_1'])).toThrow(/--role/);
    expect(() => parseCreateKeyArgs(['--app', 'app_1', '--role', 'admin'])).toThrow(/--role/);
    expect(() => parseCreateKeyArgs(['--app', 'app_1', '--role', 'advertiser_read'])).toThrow(
      /--advertiser/,
    );
    expect(() =>
      parseCreateKeyArgs(['--app', 'app_1', '--role', 'app', '--advertiser', 'adv_1']),
    ).toThrow(/--advertiser/);
  });
});

describe('seed-creatives arguments', () => {
  it('defaults the file to examples/creatives.seed.json and the catalog to global', () => {
    expect(parseSeedCreativesArgs([])).toEqual({ help: false, file: null, appId: null });
    expect(parseSeedCreativesArgs(['--file', 'x.json', '--app', 'app_1'])).toEqual({
      help: false,
      file: 'x.json',
      appId: 'app_1',
    });
    expect(parseSeedCreativesArgs(['--help'])).toEqual({ help: true });
    expect(() => parseSeedCreativesArgs(['--app', ''])).toThrow(/--app/);
  });
});
