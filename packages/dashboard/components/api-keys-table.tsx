import { revokeKeyAction } from '@/app/(dashboard)/apps/actions';
import { EmptyState } from '@/components/empty-state';
import { formatTimestamp } from '@/lib/format';
import type { ApiKeySummary } from '@/lib/queries';

/**
 * An app's API keys. There is no key value in this table and there cannot be one: the database
 * holds an argon2id hash and a public prefix, and lib/queries.ts does not select either. A key
 * is readable exactly once, on the screen that mints it.
 *
 * Revoke is a plain form POST to a server action, so it works without JavaScript, and it is
 * idempotent - a key that is already revoked stays revoked.
 */

export interface ApiKeysTableProps {
  appId: string;
  keys: readonly ApiKeySummary[];
}

export const ApiKeysTable = ({ appId, keys }: ApiKeysTableProps) => {
  if (keys.length === 0) {
    return (
      <EmptyState title="This app has no API keys." testId="api-keys-empty">
        Without one the gateway answers 401 on every call from this app: the key is how a request
        proves which tenant it belongs to. Registering an app issues its first key; issue another
        from the command line with{' '}
        <span className="ag-code">
          pnpm --filter @adgate/gateway create-key --app {appId} --role app
        </span>
        . A key is readable exactly once, on the screen that mints it.
      </EmptyState>
    );
  }
  return (
    <div className="ag-table-scroll">
      <table className="ag-table">
        <thead>
          <tr>
            <th scope="col" className="table-head">
              Key id
            </th>
            <th scope="col" className="table-head">
              Role
            </th>
            <th scope="col" className="table-head">
              Created
            </th>
            <th scope="col" className="table-head">
              Last used
            </th>
            <th scope="col" className="table-head">
              Revoked
            </th>
            <th scope="col" className="table-head">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.keyId} data-testid="api-key-row">
              <td className="table-cell ag-mono-2xs table-cell-nowrap">{key.keyId}</td>
              <td className="table-cell">
                <span className="ag-badge">{key.role}</span>
              </td>
              <td className="table-cell ag-mono-2xs table-cell-nowrap">
                {formatTimestamp(key.createdAt)}
              </td>
              <td className="table-cell ag-mono-2xs table-cell-nowrap">
                {formatTimestamp(key.lastUsedAt)}
              </td>
              <td className="table-cell ag-mono-2xs table-cell-nowrap">
                {formatTimestamp(key.revokedAt)}
              </td>
              <td className="table-cell text-right">
                {key.revokedAt === null ? (
                  <form action={revokeKeyAction}>
                    <input type="hidden" name="app_id" value={appId} />
                    <input type="hidden" name="key_id" value={key.keyId} />
                    <button
                      type="submit"
                      data-testid="revoke-key"
                      className="ag-btn ag-btn-xs ag-btn-danger"
                    >
                      Revoke
                    </button>
                  </form>
                ) : (
                  <span className="ag-badge">revoked</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
