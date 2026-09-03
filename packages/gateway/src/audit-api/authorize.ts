import type { AuthContext } from '../app-env.js';

/**
 * Who may read and verify a stored audit record (docs/api.md roles): an `app` key, the records
 * of its own app; an `advertiser_read` key, the records whose creative belongs to its
 * advertiser, whichever app served it (a global-catalog creative serves in any app, and the
 * advertiser's verification report spans all of them). Nothing else is visible, and the routes
 * answer the same 404 as for an unknown id, so a key never learns whether an id exists in
 * another tenant.
 */
export interface AuditVisibility {
  /** audit_records.app_id: the app whose chain the record is in. */
  appId: string;
  /** The advertiser of the creative the record names, or null (suppress, or the row is gone). */
  creativeAdvertiserId: string | null;
}

export const canReadAudit = (auth: AuthContext, target: AuditVisibility): boolean => {
  switch (auth.role) {
    case 'app':
      return target.appId === auth.app_id;
    case 'advertiser_read':
      return auth.advertiser_id !== null && target.creativeAdvertiserId === auth.advertiser_id;
    default:
      return false;
  }
};
