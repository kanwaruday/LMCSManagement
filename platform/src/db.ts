// Postgres client and the tenant-scoped transaction every request runs in.
import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

// Lazy: no connection is opened until the first query. URL comes from loadConfig.
export function connect(url: string, options: postgres.Options<{}> = {}): Sql {
  return postgres(url, { onnotice: () => {}, ...options });
}

// Runs fn in a transaction with app.tenant_id set, so row level security (FORCE, binding the
// owner the app connects as) limits every query to that tenant.
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>, db: Sql): Promise<T> {
  return db.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
