// Postgres client and the tenant-scoped transaction every request runs in.
import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export const LMCS_TENANT_ID = '6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01';

// Lazy: no connection is opened until the first query.
export const sql: Sql = postgres(process.env.DATABASE_URL ?? '', { onnotice: () => {} });

// Runs fn in a transaction as the non-superuser role lmcs_app with app.tenant_id set,
// so row level security limits every query to that tenant.
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>, db: Sql = sql): Promise<T> {
  return db.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`set local role lmcs_app`;
    return fn(tx);
  }) as Promise<T>;
}
