import { describe, expect, it } from 'vitest';

import type { AuthContext } from '../app-env.js';
import { canReadAudit } from './authorize.js';

const appKey: AuthContext = { key_id: 'key_1', app_id: 'app_1', role: 'app', advertiser_id: null };
const advertiserKey: AuthContext = {
  key_id: 'key_2',
  app_id: 'app_2',
  role: 'advertiser_read',
  advertiser_id: 'adv_1',
};

describe('canReadAudit', () => {
  it('lets an app key read its own app’s records only', () => {
    expect(canReadAudit(appKey, { appId: 'app_1', creativeAdvertiserId: null })).toBe(true);
    expect(canReadAudit(appKey, { appId: 'app_1', creativeAdvertiserId: 'adv_1' })).toBe(true);
    expect(canReadAudit(appKey, { appId: 'app_2', creativeAdvertiserId: 'adv_1' })).toBe(false);
  });

  it('lets an advertiser_read key read records naming its creatives, whatever the app', () => {
    expect(canReadAudit(advertiserKey, { appId: 'app_1', creativeAdvertiserId: 'adv_1' })).toBe(
      true,
    );
    expect(canReadAudit(advertiserKey, { appId: 'app_2', creativeAdvertiserId: 'adv_1' })).toBe(
      true,
    );
    expect(canReadAudit(advertiserKey, { appId: 'app_2', creativeAdvertiserId: 'adv_2' })).toBe(
      false,
    );
    expect(canReadAudit(advertiserKey, { appId: 'app_2', creativeAdvertiserId: null })).toBe(false);
  });

  it('never lets an advertiser_read key without an advertiser read anything', () => {
    const broken: AuthContext = { ...advertiserKey, advertiser_id: null };
    expect(canReadAudit(broken, { appId: 'app_2', creativeAdvertiserId: null })).toBe(false);
  });
});
