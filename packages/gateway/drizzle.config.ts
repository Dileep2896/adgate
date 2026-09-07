import { defineConfig } from 'drizzle-kit';

// drizzle-kit reads the table definitions and writes SQL migrations plus snapshots into
// ./drizzle. `pnpm --filter @adgateio/gateway db:generate` needs no database: it diffs the
// schema against the last snapshot. `pnpm db:migrate` (src/db/migrate.ts) applies the SQL.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/tables/*.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
