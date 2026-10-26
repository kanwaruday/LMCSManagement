import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { withTenant, LMCS_TENANT_ID } from '../src/db.ts';
import { buildServer } from '../src/server.ts';

let db: Awaited<ReturnType<typeof testDb>>;
before(async () => { db = await testDb(); });
after(async () => { await db?.close(); });

test('migrations apply to an empty database', async () => {
  const applied = await db.migrate();
  assert.deepEqual(applied, ['001_core.sql']);
  assert.deepEqual(await db.migrate(), [], 'second run applies nothing');
  const [t] = await db.sql`select name, allowed_domains from tenants where id = ${LMCS_TENANT_ID}`;
  assert.equal(t.name, 'LMCS');
  assert.deepEqual(t.allowed_domains, ['lms.org.in']);
  const campuses = await db.sql`select code from campuses order by code`;
  assert.deepEqual(campuses.map((c) => c.code), ['HES', 'LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']);
  const [sw] = await db.sql`select "on" from switches where feature = 'staff_auto_signin'`;
  assert.equal(sw.on, false);
  const rules = await db.sql`select department, role from role_rules order by department`;
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

test("RLS hides another tenant's rows", async () => {
  const other = '00000000-0000-4000-8000-0000000000ff';
  // Seeded as the migrating (super)user; reads below run as the non-superuser app role.
  await db.sql`insert into tenants (id, name, allowed_domains) values (${other}, 'Other School', ${['other.example.test']})`;
  await db.sql`insert into people (tenant_id, employee_code, auth_email, name, campus_code, department, active)
               values (${other}, 'T-0001', 'person1@other.example.test', 'Person One', 'X1', 'Teaching', true)`;
  const seen = await withTenant(LMCS_TENANT_ID, async (tx) => ({
    role: (await tx`select current_user as u`)[0].u,
    people: (await tx`select * from people where tenant_id = ${other}`).length,
    tenants: (await tx`select id from tenants`).map((r) => r.id),
  }), db.sql);
  assert.equal(seen.role, 'lmcs_app');
  assert.equal(seen.people, 0);
  assert.deepEqual(seen.tenants, [LMCS_TENANT_ID]);
  const own = await withTenant(other, async (tx) => (await tx`select * from people`).length, db.sql);
  assert.equal(own, 1, 'the owning tenant still sees its row');
  await assert.rejects(withTenant(LMCS_TENANT_ID, (tx) =>
    tx`insert into people (tenant_id, employee_code, name) values (${other}, 'T-0002', 'Person Two')`, db.sql),
    /row-level security/, 'cannot write into another tenant');
});

test('audit_log is append-only for the app role', async () => {
  await withTenant(LMCS_TENANT_ID, (tx) =>
    tx`insert into audit_log (tenant_id, who, action, entity, entity_id) values (${LMCS_TENANT_ID}, 'person1@example.test', 'test', 'x', '1')`, db.sql);
  await assert.rejects(withTenant(LMCS_TENANT_ID, (tx) => tx`update audit_log set action = 'changed'`, db.sql), /permission denied/);
  await assert.rejects(withTenant(LMCS_TENANT_ID, (tx) => tx`delete from audit_log`, db.sql), /permission denied/);
});
