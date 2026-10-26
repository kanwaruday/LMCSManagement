// Before the hd (Workspace domain) check goes live: how many allowlist entries each domain has, per tenant, and whether
// the tenant allows it. Domain counts only, never an address. Any `allowed: false` line goes to Uday before the switch.
// Run: DATABASE_URL=... node platform/tools/allowlist-domains.ts   (reads the allowlist table the Task 3 sync fills)
import { fileURLToPath } from 'node:url';
import { connect, withTenant, type Sql } from '../src/db.ts';

export async function domainCounts(sql: Sql) {
  const out: { tenant: string; domain: string; count: number; allowed: boolean }[] = [];
  for (const t of await sql`select id, name, allowed_domains from tenants order by name`) {
    const rows = await withTenant(t.id, (tx) => tx`select lower(split_part(trim(email), '@', 2)) as domain, count(*)::int as count
                                                  from allowlist group by 1 order by 2 desc, 1`, sql);
    for (const r of rows) out.push({ tenant: t.name, domain: r.domain, count: r.count, allowed: (t.allowed_domains as string[]).includes(r.domain) });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const sql = connect(process.env.DATABASE_URL, { max: 1 });
  const counts = await domainCounts(sql);
  for (const c of counts) console.log(`${c.tenant}  ${c.domain || '(no domain)'}  ${c.count}  ${c.allowed ? 'allowed' : 'NOT ALLOWED'}`);
  const outside = counts.filter((c) => !c.allowed).reduce((n, c) => n + c.count, 0);
  console.log(`${outside} allowlist entr${outside === 1 ? 'y' : 'ies'} outside the allowed domains`);
  await sql.end();
  process.exitCode = outside ? 1 : 0;
}
