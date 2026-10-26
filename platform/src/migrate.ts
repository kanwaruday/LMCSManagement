// Applies db/migrations/*.sql in name order, each in its own transaction, recorded in schema_migrations.
// schema_migrations is deliberately exempt from tenant_id/RLS: it is per-database, not per-tenant.
// Run as the database owner (Render start command: node src/migrate.ts && node src/server.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Sql } from './db.ts';

const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));

export async function migrate(sql: Sql): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
  const applied: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(dir + name, 'utf8'));
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    applied.push(name);
  }
  return applied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import('./config.ts');
  const { connect } = await import('./db.ts');
  const sql = connect(loadConfig(process.env).DATABASE_URL, { max: 1 });
  const applied = await migrate(sql);
  console.log(applied.length ? `migrations applied: ${applied.join(', ')}` : 'migrations: up to date');
  await sql.end();
}
