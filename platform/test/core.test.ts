import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, LMCS_TENANT_ID } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { withTenant } from '../src/db.ts';
import { buildServer } from '../src/server.ts';

let db: Awaited<ReturnType<typeof testDb>>;
let applied: string[];
before(async () => { db = await testDb(); applied = await db.migrate(); });
after(async () => { await db?.close(); });
const asLmcs = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(LMCS_TENANT_ID, fn, db.sql);

test('migrations apply to an empty database', async () => {
  assert.deepEqual(applied, ['001_core.sql', '002_sync.sql', '003_sync_order.sql']);
  assert.deepEqual(await db.migrate(), [], 'second run applies nothing');
  // tenants is readable without a tenant set (sign-in resolves the tenant from the hd domain)
  const [t] = await db.sql`select name, allowed_domains from tenants where id = ${LMCS_TENANT_ID}`;
  assert.equal(t.name, 'LMCS');
  assert.deepEqual(t.allowed_domains, ['lms.org.in']);
  assert.equal((await db.sql`select * from campuses`).length, 0, 'no tenant set: tenant tables show nothing');
  const { campuses, sw, rules } = await asLmcs(async (tx) => ({
    campuses: await tx`select code from campuses order by code`,
    sw: (await tx`select "on" from switches where feature = 'staff_auto_signin'`)[0],
    rules: await tx`select department, role from role_rules order by department`,
  }));
  assert.deepEqual(campuses.map((c) => c.code), ['HES', 'LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']);
  assert.equal(sw.on, false);
  assert.equal(rules.find((r) => r.department === 'Teaching')?.role, 'Teacher');
  assert.equal(rules.find((r) => r.department === 'Transport')?.role, 'Staff');
  assert.equal(rules.find((r) => r.department === 'AdminTM')?.role, null);
  const noRls = await db.sql`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${db.schema} and c.relkind = 'r' and c.relname <> 'schema_migrations'
      and not (c.relrowsecurity and c.relforcerowsecurity)`;
  assert.deepEqual([...noRls], [], 'every table has ENABLE + FORCE row level security');
});

test('loadConfig names missing vars without values', () => {
  const secret = 'https://secret-origin.example.test';
  assert.throws(() => loadConfig({ APP_ORIGIN: secret }), (e: Error) => {
    assert.match(e.message, /DATABASE_URL/);
    assert.ok(!e.message.includes(secret), 'message must not contain values');
    return true;
  });
  const c = loadConfig({ DATABASE_URL: 'postgres://x@localhost/y', APP_ORIGIN: 'https://app.example.test' });
  assert.equal(c.APP_ORIGIN, 'https://app.example.test');
  assert.equal(c.PORT, 10000);
  const t = loadConfig({ DATABASE_URL: 'x', APP_ORIGIN: 'y', SYNC_SECRET_T2: 'two', OTHER_SECRET: 'no' }) as Record<string, unknown>;
  assert.equal(t.SYNC_SECRET_T2, 'two', 'per-tenant sync secrets pass through');
  assert.equal(t.OTHER_SECRET, undefined, 'unlisted vars do not');
});

test('health reports db true', async () => {
  const app = buildServer({ sql: db.sql, config: { APP_ORIGIN: 'https://app.example.test' } });
  const res = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://app.example.test' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.db, true);
  for (const k of ['google', 'hooks', 'lastSync', 'lastBackup', 'lastRestoreTest']) assert.ok(k in body, k);
  assert.equal(res.headers['access-control-allow-origin'], 'https://app.example.test');
  assert.match(String(res.headers['content-security-policy']), /default-src 'none'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  const other = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example.test' } });
  assert.equal(other.headers['access-control-allow-origin'], undefined);
  await app.close();
});

test('queries run as the non-superuser owner, not a superuser', async () => {
  const [r] = await db.sql`select current_user as u, rolsuper, rolbypassrls, rolcreaterole
                           from pg_roles where rolname = current_user`;
  assert.equal(r.u, db.role);
  assert.deepEqual([r.rolsuper, r.rolbypassrls, r.rolcreaterole], [false, false, false]);
  const [o] = await db.sql`select tableowner from pg_tables where schemaname = ${db.schema} and tablename = 'people'`;
  assert.equal(o.tableowner, db.role, 'the role owns the tables, so only FORCE RLS restricts it');
});

test("RLS hides another tenant's rows", async () => {
  const other = '00000000-0000-4000-8000-0000000000ff';
  await withTenant(other, async (tx) => {
    await tx`insert into tenants (id, name, allowed_domains) values (${other}, 'Other School', ${['other.example.test']})`;
    await tx`insert into people (tenant_id, employee_code, auth_email, name, campus_code, department, active)
             values (${other}, 'T-0001', 'person1@other.example.test', 'Person One', 'X1', 'Teaching', true)`;
  }, db.sql);
  const seen = await asLmcs(async (tx) => ({
    people: (await tx`select * from people where tenant_id = ${other}`).length,
    peopleAll: (await tx`select * from people`).length,
  }));
  assert.equal(seen.people, 0);
  assert.equal(seen.peopleAll, 0);
  assert.equal((await db.sql`select * from people`).length, 0, 'no tenant set: nothing');
  const own = await withTenant(other, async (tx) => (await tx`select * from people`).length, db.sql);
  assert.equal(own, 1, 'the owning tenant still sees its row');
  await assert.rejects(asLmcs((tx) =>
    tx`insert into people (tenant_id, employee_code, name) values (${other}, 'T-0002', 'Person Two')`),
    /row-level security/, 'WITH CHECK: cannot write into another tenant');
  const renamed = await asLmcs((tx) => tx`update tenants set name = 'Renamed' where id = ${other} returning id`);
  assert.equal(renamed.length, 0, 'cannot rename another tenant (readable is not writable)');
});

test('audit_log is append-only, even for the owner', async () => {
  await asLmcs((tx) =>
    tx`insert into audit_log (tenant_id, who, action, entity, entity_id) values (${LMCS_TENANT_ID}, 'person1@example.test', 'test', 'x', '1')`);
  await assert.rejects(asLmcs((tx) => tx`update audit_log set action = 'changed'`), /append-only/);
  await assert.rejects(asLmcs((tx) => tx`delete from audit_log`), /append-only/);
  await assert.rejects(asLmcs((tx) => tx`truncate audit_log`), /append-only/);
  assert.equal((await asLmcs((tx) => tx`select action from audit_log`))[0].action, 'test');
});
