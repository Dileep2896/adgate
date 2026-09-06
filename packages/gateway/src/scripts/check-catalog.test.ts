import { describe, expect, it } from 'vitest';

import type { AppReadiness } from '../catalog/readiness.js';
import { UsageError } from './args.js';
import {
  CHECK_CATALOG_USAGE,
  parseCheckCatalogArgs,
  renderCatalogReport,
} from './check-catalog.js';

/** The command line of the catalog diagnostic, and the text an operator reads. */

const readiness = (patch: Partial<AppReadiness> = {}): AppReadiness => ({
  app_id: 'app_1',
  app_name: 'Demo App',
  error: null,
  total: 2,
  deliverable: 1,
  rows: [
    { label: 'cr_1  Partner Postgres', result: { deliverable: true } },
    {
      label: 'cr_2  Partner Cloud',
      result: {
        deliverable: false,
        reason: 'network_not_enabled',
        detail: 'add an affiliate entry for impact to the app’s policy demand list',
      },
    },
  ],
  blocked: [
    {
      reason: 'network_not_enabled',
      detail: 'add an affiliate entry for impact to the app’s policy demand list',
      count: 1,
    },
  ],
  ...patch,
});

describe('parseCheckCatalogArgs', () => {
  it('defaults to every app', () => {
    expect(parseCheckCatalogArgs([])).toEqual({ help: false, appId: null });
  });

  it('reads --app', () => {
    expect(parseCheckCatalogArgs(['--app', 'app_x'])).toEqual({ help: false, appId: 'app_x' });
    expect(parseCheckCatalogArgs(['--app=app_x'])).toEqual({ help: false, appId: 'app_x' });
  });

  it('answers --help and rejects anything it does not know', () => {
    expect(parseCheckCatalogArgs(['--help'])).toEqual({ help: true });
    expect(() => parseCheckCatalogArgs(['--nope'])).toThrow(UsageError);
    expect(() => parseCheckCatalogArgs(['--app'])).toThrow(UsageError);
    expect(CHECK_CATALOG_USAGE).toContain('check-catalog');
  });
});

describe('renderCatalogReport', () => {
  it('prints a yes/no row per creative, then the grouped reasons', () => {
    const text = renderCatalogReport([readiness()]);
    expect(text).toContain('app_1 (Demo App): 1 of 2 creatives can serve');
    expect(text).toContain('yes  cr_1  Partner Postgres');
    expect(text).toMatch(/^ {4}no {3}cr_2 {2}Partner Cloud +network_not_enabled$/m);
    expect(text).toContain('1 blocked: network_not_enabled - add an affiliate entry for impact');
    expect(text).toContain('1 apps, 2 creatives checked, 1 can serve');
  });

  it('aligns the reason column across creatives with different label widths', () => {
    const lines = renderCatalogReport([readiness()]).split('\n');
    const yes = lines.find((line) => line.startsWith('    yes'));
    const no = lines.find((line) => line.startsWith('    no '));
    // The shorter label is padded, so the reason starts past the widest label on every row.
    expect(no?.indexOf('  network_not_enabled')).toBe(yes?.length);
  });

  it('says so when an app has no catalog and when there is nothing to check', () => {
    expect(
      renderCatalogReport([readiness({ total: 0, deliverable: 0, rows: [], blocked: [] })]),
    ).toContain('no creatives');
    expect(renderCatalogReport([])).toContain('No apps to check');
  });

  it('reports an unreadable policy instead of a table', () => {
    const text = renderCatalogReport([
      readiness({
        error: 'stored policy is unreadable (PolicyValidationError)',
        rows: [],
        blocked: [],
        total: 0,
        deliverable: 0,
      }),
    ]);
    expect(text).toContain('unreadable');
    expect(text).not.toContain('yes');
  });
});
