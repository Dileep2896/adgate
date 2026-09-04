import { revokeKeyAction } from '@/app/(dashboard)/apps/actions';
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

export const ApiKeysTable = ({ appId, keys }: ApiKeysTableProps) => (
  <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
    <table className="w-full border-collapse">
      <thead className="border-b border-stone-200 bg-stone-50">
        <tr>
          <th className="table-head">Key id</th>
          <th className="table-head">Role</th>
          <th className="table-head">Created</th>
          <th className="table-head">Last used</th>
          <th className="table-head">Revoked</th>
          <th className="table-head">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-100">
        {keys.length === 0 ? (
          <tr>
            <td className="table-cell text-stone-500" colSpan={6}>
              This app has no API keys. Issue one with{' '}
              <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">
                pnpm --filter @adgate/gateway create-key --app {appId} --role app
              </code>
              .
            </td>
          </tr>
        ) : (
          keys.map((key) => (
            <tr key={key.keyId} data-testid="api-key-row">
              <td className="table-cell font-mono text-xs">{key.keyId}</td>
              <td className="table-cell">{key.role}</td>
              <td className="table-cell font-mono text-xs">{formatTimestamp(key.createdAt)}</td>
              <td className="table-cell font-mono text-xs">{formatTimestamp(key.lastUsedAt)}</td>
              <td className="table-cell font-mono text-xs">{formatTimestamp(key.revokedAt)}</td>
              <td className="table-cell text-right">
                {key.revokedAt === null ? (
                  <form action={revokeKeyAction}>
                    <input type="hidden" name="app_id" value={appId} />
                    <input type="hidden" name="key_id" value={key.keyId} />
                    <button
                      type="submit"
                      data-testid="revoke-key"
                      className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  </form>
                ) : (
                  <span className="text-xs text-stone-400">revoked</span>
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);
