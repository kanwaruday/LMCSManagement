import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { testDb, LMCS_TENANT_ID } from './helpers.ts';
import { withTenant, type Tx } from '../src/db.ts';
import { buildServer } from '../src/server.ts';

const SECRET = 'test-sync-secret';
const SECRET_T2 = 'test-sync-secret-two';
const T2 = '0e9a7c55-1b2d-4f3e-8a6b-2c4d6e8f0a12';
const ORIGIN = 'https://app.example.test';
const ZW = '\u200B';
const at = (n: string) => `${n}@example.test`;

const dbs: Awaited<ReturnType<typeof testDb>>[] = [];
after(() => Promise.all(dbs.map((d) => d.close())));

// A fresh schema per test: every test starts from the seeded tenant and nothing else.
async function setup() {
  const db = await testDb();
  dbs.push(db);
  await db.migrate();
  const app = buildServer({ sql: db.sql, config: { APP_ORIGIN: ORIGIN, SYNC_SECRET: SECRET, SYNC_SECRET_T2: SECRET_T2 } });
  const asLmcs = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(LMCS_TENANT_ID, fn, db.sql);
  return { db, app, asLmcs };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const sign = (secret: string, sentAt: string, raw: string) => createHmac('sha256', secret).update(`${sentAt}.${raw}`).digest('hex');
// Each push is newer than the last (the platform refuses a sentAt at or before the last accepted one).
let clock = 0;
const nextSentAt = () => new Date((clock = Math.max(Date.now(), clock + 1))).toISOString();
function push(s: Setup, kind: 'staff' | 'allowlist', rows: unknown[], { secret = SECRET, sentAt = nextSentAt() } = {}) {
  const raw = JSON.stringify({ sentAt, rows });
  return s.app.inject({ method: 'POST', url: `/api/sync/${kind}`, payload: Buffer.from(raw, 'utf8'),
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-sync-signature': sign(secret, sentAt, raw) } });
}
const poll = (s: Setup, { secret = SECRET, sentAt = nextSentAt() } = {}) => s.app.inject({ method: 'GET',
  url: `/api/sync/pending?sentAt=${encodeURIComponent(sentAt)}`, headers: { 'x-sync-signature': sign(secret, sentAt, '') } });
const staff = (code: string, extra: Record<string, unknown> = {}) => ({
  employeeCode: code, authEmail: at(code.replace(/\W/g, '').toLowerCase()), name: `Name ${code}`, department: 'Teaching',
  designation: 'PRT', reportsTo: '', subjects: [], active: true, ...extra,
});
const people = (s: Setup) => s.asLmcs((tx) => tx`select employee_code, auth_email, name, campus_code, department, designation,
  reports_to, subjects, active from people order by employee_code`);
const activeCount = async (s: Setup) => (await s.asLmcs((tx) => tx`select count(*)::int as n from people where active`))[0].n as number;

test('upsert by employee code', async () => {
  const s = await setup();
  const first = await push(s, 'staff', [
    staff('KUL/T-0001', { authEmail: ` ${ZW}Person1@Example.TEST `, department: `${ZW}Teaching${ZW} `, subjects: ['C4_Science', ` ${ZW}`, 'C5_Maths'], campusId: 'LMS6' }),
    staff('HES/T-0002', { name: 'Ánya Śarmā' }), // non-ASCII: the signature is over the UTF-8 bytes
    staff('XYZ/T-0003'),
    staff('JOG/T-0004', { authEmail: '12' }), // not an email (EmpMaster.AuthEmail holds row numbers): stored as null
  ]);
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(first.json(), { ok: true, received: 4, changed: 4, deactivated: 0 });
  let rows = await people(s);
  assert.equal(rows.length, 4);
  assert.deepEqual({ ...rows.find((r) => r.employee_code === 'KUL/T-0001') }, { employee_code: 'KUL/T-0001', auth_email: 'person1@example.test', name: 'Name KUL/T-0001',
    campus_code: 'LMS1', department: 'Teaching', designation: 'PRT', reports_to: null, subjects: ['C4_Science', 'C5_Maths'], active: true },
    'cleaned, emails lowercased, campus from the code prefix (the payload campusId is ignored)');
  assert.equal(rows.find((r) => r.employee_code === 'HES/T-0002')!.campus_code, null, 'HES has no campus prefix: never guessed');
  assert.equal(rows.find((r) => r.employee_code === 'HES/T-0002')!.name, 'Ánya Śarmā');
  assert.equal(rows.find((r) => r.employee_code === 'XYZ/T-0003')!.campus_code, null, 'unknown prefix: null');
  assert.equal(rows.find((r) => r.employee_code === 'JOG/T-0004')!.campus_code, 'LMS6');
  assert.equal(rows.find((r) => r.employee_code === 'JOG/T-0004')!.auth_email, null);

  const same = await push(s, 'staff', [staff('KUL/T-0001', { authEmail: 'person1@example.test', subjects: ['C4_Science', 'C5_Maths'] }),
    staff('HES/T-0002', { name: 'Ánya Śarmā' }), staff('XYZ/T-0003'), staff('JOG/T-0004', { authEmail: '12', name: 'Renamed' })]);
  assert.deepEqual(same.json(), { ok: true, received: 4, changed: 1, deactivated: 0 }, 'only the renamed row changed');
  rows = await people(s);
  assert.equal(rows.length, 4, 'updated in place, no duplicates');
  assert.equal(rows.find((r) => r.employee_code === 'JOG/T-0004')!.name, 'Renamed');

  assert.equal((await push(s, 'staff', [{ name: 'no code' }])).statusCode, 400, 'a row without an employee code is refused');
  assert.equal((await push(s, 'staff', 'nope' as unknown as unknown[])).statusCode, 400);
});

test('missing people marked inactive not deleted', async () => {
  const s = await setup();
  const all = Array.from({ length: 20 }, (_, i) => staff(`KUL/T-${String(i + 1).padStart(4, '0')}`));
  await push(s, 'staff', all);
  // T-0001 missing from the Sheet, T-0002 flipped to inactive there: 2 of 20 = 10%, allowed.
  const res = await push(s, 'staff', [{ ...all[1], active: false }, ...all.slice(2)]);
  assert.deepEqual(res.json(), { ok: true, received: 19, changed: 2, deactivated: 2 });
  const rows = await people(s);
  assert.equal(rows.length, 20, 'nobody deleted');
  assert.deepEqual(rows.filter((r) => !r.active).map((r) => r.employee_code), ['KUL/T-0001', 'KUL/T-0002']);
  // back in the Sheet and Active again: reactivated
  await push(s, 'staff', all);
  assert.equal(await activeCount(s), 20);
});

test('refuses mass deactivation', async () => {
  const s = await setup();
  const all = Array.from({ length: 100 }, (_, i) => staff(`KUL/T-${String(i + 1).padStart(4, '0')}`));
  await push(s, 'staff', all);
  const res = await push(s, 'staff', all.slice(11).map((r) => ({ ...r, name: 'Changed' }))); // 11 of 100 missing
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { ok: false, received: 89, changed: 0, deactivated: 0, refused: 'MASS_DEACTIVATION' });
  assert.equal(await activeCount(s), 100, 'nobody deactivated');
  const [{ n }] = await s.asLmcs((tx) => tx`select count(*)::int as n from people where name = 'Changed'`);
  assert.equal(n, 0, 'nothing changed at all');
  const events = await s.asLmcs((tx) => tx`select kind, detail from health_events`);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'sync_refused');
  assert.deepEqual(events[0].detail, { sync: 'staff', refused: 'MASS_DEACTIVATION', active: 100, wouldDeactivate: 11 });
  const [run] = await s.asLmcs((tx) => tx`select ok, refused, received from sync_runs order by id desc limit 1`);
  assert.deepEqual({ ...run }, { ok: false, refused: 'MASS_DEACTIVATION', received: 89 });
  // 10 of 100 is the limit, not over it
  assert.equal((await push(s, 'staff', all.slice(10))).statusCode, 200);
  assert.equal(await activeCount(s), 90);
});

test('bad signature 401', async () => {
  const s = await setup();
  const wrong = await push(s, 'staff', [staff('KUL/T-0001')], { secret: 'another-secret' });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().error, 'BAD_SIGNATURE');
  const sentAt = new Date().toISOString();
  const raw = JSON.stringify({ sentAt, rows: [staff('KUL/T-0001')] });
  const tampered = await s.app.inject({ method: 'POST', url: '/api/sync/staff', payload: raw.replace('PRT', 'TGT'),
    headers: { 'content-type': 'application/json', 'x-sync-signature': sign(SECRET, sentAt, raw) } });
  assert.equal(tampered.statusCode, 401, 'signature covers the raw body');
  const none = await s.app.inject({ method: 'POST', url: '/api/sync/allowlist', payload: raw, headers: { 'content-type': 'application/json' } });
  assert.equal(none.statusCode, 401);
  // no SYNC_SECRET configured: nothing verifies
  const unset = buildServer({ sql: s.db.sql, config: { APP_ORIGIN: ORIGIN } });
  assert.equal((await push({ ...s, app: unset }, 'staff', [staff('KUL/T-0001')])).statusCode, 401);
  assert.equal((await people(s)).length, 0);
});

test('stale sentAt 401', async () => {
  const s = await setup();
  const old = await push(s, 'staff', [staff('KUL/T-0001')], { sentAt: new Date(Date.now() - 6 * 60_000).toISOString() });
  assert.equal(old.statusCode, 401);
  assert.equal(old.json().error, 'STALE');
  const future = await push(s, 'staff', [staff('KUL/T-0001')], { sentAt: new Date(Date.now() + 6 * 60_000).toISOString() });
  assert.equal(future.statusCode, 401);
  assert.equal((await push(s, 'staff', [staff('KUL/T-0001')], { sentAt: 'yesterday' })).statusCode, 401);
  assert.equal((await people(s)).length, 0);
});

const sessionFor = async (s: Setup, email: string) => {
  const token = `${LMCS_TENANT_ID}.${randomBytes(32).toString('base64url')}`;
  await s.asLmcs((tx) => tx`insert into sessions (tenant_id, token_hash, person_email, expires_at)
    values (${LMCS_TENANT_ID}, ${createHash('sha256').update(token).digest('hex')}, ${email}, now() + interval '30 days')`);
  return token;
};
const allowRow = (email: string, extra: Record<string, unknown> = {}) => ({ email, name: 'N', campusId: 'LMS1', roles: 'Principal', canApprove: false, ...extra });

test('allowlist removal revokes sessions', async () => {
  const s = await setup();
  await s.asLmcs((tx) => tx`update tenants set allowed_domains = ${['example.test']} where id = ${LMCS_TENANT_ID}`);
  const first = await push(s, 'allowlist', [
    allowRow(` ${ZW}Owner@Example.test`, { roles: 'Owner', campusId: 'all' }),
    allowRow(at('coord'), { roles: ' Coordinator , Principal ', campusId: 'ALL', canApprove: true }),
    allowRow(at('gone')),
  ]);
  assert.deepEqual(first.json(), { ok: true, received: 3, changed: 3, deactivated: 0 });
  const rows = await s.asLmcs((tx) => tx`select email, campus_code, roles, can_approve from allowlist order by email`);
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { email: at('coord'), campus_code: 'ALL', roles: ['Coordinator', 'Principal'], can_approve: true },
    { email: at('gone'), campus_code: 'LMS1', roles: ['Principal'], can_approve: false },
    { email: at('owner'), campus_code: 'ALL', roles: ['Owner'], can_approve: false },
  ]);
  const gone = await sessionFor(s, at('gone'));
  const kept = await sessionFor(s, at('coord'));
  const me = (token: string) => s.app.inject({ method: 'GET', url: '/api/session', headers: { authorization: `Bearer ${token}` } });
  assert.equal((await me(gone)).statusCode, 200);

  const res = await push(s, 'allowlist', [allowRow(at('owner'), { roles: 'Owner', campusId: 'ALL' }),
    allowRow(at('coord'), { roles: 'Coordinator,Principal', campusId: 'ALL', canApprove: true })]);
  assert.deepEqual(res.json(), { ok: true, received: 2, changed: 1, deactivated: 1 });
  assert.equal((await me(gone)).statusCode, 401);
  const sess = await s.asLmcs((tx) => tx`select person_email, revoked_at is not null as revoked from sessions order by person_email`);
  assert.deepEqual(sess.map((r) => ({ ...r })), [{ person_email: at('coord'), revoked: false }, { person_email: at('gone'), revoked: true }]);
  assert.equal((await me(kept)).statusCode, 200);

  const empty = await push(s, 'allowlist', []);
  assert.equal(empty.statusCode, 409, 'an empty allowlist would lock everyone out');
  assert.equal(empty.json().refused, 'EMPTY_ALLOWLIST');
  assert.equal((await s.asLmcs((tx) => tx`select 1 from allowlist`)).length, 2);
});

test('run logged in sync_runs', async () => {
  const s = await setup();
  await push(s, 'staff', [staff('KUL/T-0001'), staff('KUL/T-0002')]);
  await push(s, 'allowlist', [allowRow(at('owner'), { roles: 'Owner' })]);
  const runs = await s.asLmcs((tx) => tx`select kind, ok, received, changed, deactivated, refused, finished_at is not null as finished
    from sync_runs order by id`);
  assert.deepEqual(runs.map((r) => ({ ...r })), [
    { kind: 'staff', ok: true, received: 2, changed: 2, deactivated: 0, refused: null, finished: true },
    { kind: 'allowlist', ok: true, received: 1, changed: 1, deactivated: 0, refused: null, finished: true },
  ]);
});

test('public health shows only aggregates; Owner admin health shows own tenant detail', async () => {
  const s = await setup();
  await s.asLmcs((tx) => tx`update tenants set allowed_domains = ${['example.test']} where id = ${LMCS_TENANT_ID}`);
  const pub = async () => (await s.app.inject({ method: 'GET', url: '/api/health' })).json().lastSync;
  assert.deepEqual(await pub(), { staff: null, allowlist: null }, 'no runs yet');
  await push(s, 'staff', [staff('KUL/T-0001'), staff('KUL/T-0002')]);
  await push(s, 'allowlist', [allowRow(at('owner'), { roles: 'Owner', campusId: 'ALL' }), allowRow(at('principal'))]);
  const body = (await s.app.inject({ method: 'GET', url: '/api/health' })).body;
  assert.deepEqual(JSON.parse(body).lastSync, { staff: { ok: true, staleMinutes: 0 }, allowlist: { ok: true, staleMinutes: 0 } });
  assert.doesNotMatch(body, /LMCS|received|changed|deactivated|refused|error/, 'no tenant name, no counts');
  await push(s, 'staff', []); // refused: 100% deactivation
  assert.equal((await pub()).staff.ok, false, 'a refused last run shows not ok');

  const admin = async (email: string) => s.app.inject({ method: 'GET', url: '/api/admin/health',
    headers: { authorization: `Bearer ${await sessionFor(s, email)}` } });
  assert.equal((await admin(at('principal'))).statusCode, 403);
  assert.equal((await s.app.inject({ method: 'GET', url: '/api/admin/health' })).statusCode, 401);
  const detail = (await admin(at('owner'))).json();
  assert.equal(detail.ok, true);
  assert.deepEqual({ ...detail.lastSync.staff, at: undefined }, { at: undefined, ok: false, received: 0, changed: 0, deactivated: 0, refused: 'MASS_DEACTIVATION', error: null });
  assert.equal(detail.lastSync.allowlist.received, 2);
});

test('sync request: Owner only, pending until a push of each kind succeeds', async () => {
  const s = await setup();
  await s.asLmcs((tx) => tx`update tenants set allowed_domains = ${['example.test']} where id = ${LMCS_TENANT_ID}`);
  await push(s, 'allowlist', [allowRow(at('owner'), { roles: 'Owner', campusId: 'ALL' }), allowRow(at('principal'))]);
  assert.deepEqual((await poll(s)).json(), { ok: true, pending: false });
  assert.equal((await poll(s, { secret: 'another-secret' })).statusCode, 401);
  const ask = async (email: string) => s.app.inject({ method: 'POST', url: '/api/sync/request',
    headers: { authorization: `Bearer ${await sessionFor(s, email)}` } });
  assert.equal((await ask(at('principal'))).statusCode, 403);
  assert.deepEqual((await poll(s)).json(), { ok: true, pending: false });
  assert.deepEqual((await ask(at('owner'))).json(), { ok: true });
  assert.deepEqual((await poll(s)).json(), { ok: true, pending: true });
  assert.deepEqual((await poll(s)).json(), { ok: true, pending: true }, 'a poll alone never clears it');
  await push(s, 'allowlist', [allowRow(at('owner'), { roles: 'Owner', campusId: 'ALL' }), allowRow(at('principal'))]);
  assert.deepEqual((await poll(s)).json(), { ok: true, pending: true }, 'staff still owed');
  await push(s, 'staff', []); // 0 active people, so an empty staff push is accepted
  assert.deepEqual((await poll(s)).json(), { ok: true, pending: false }, 'both kinds pushed successfully');
  await push(s, 'staff', [staff('KUL/T-0001')]);
  await ask(at('owner'));
  assert.equal((await push(s, 'staff', [])).statusCode, 409);
  assert.deepEqual((await poll(s)).json(), { ok: true, pending: true }, 'a refused push does not clear it');
});

test('replayed or out-of-order pushes and polls are refused', async () => {
  const s = await setup();
  const sentAt = nextSentAt();
  assert.equal((await push(s, 'staff', [staff('KUL/T-0001')], { sentAt })).statusCode, 200);
  const replay = await push(s, 'staff', [staff('KUL/T-0001', { name: 'Replayed' })], { sentAt });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json().error, 'STALE_PUSH');
  const older = await push(s, 'staff', [staff('KUL/T-0001', { name: 'Older' })], { sentAt: new Date(Date.parse(sentAt) - 1000).toISOString() });
  assert.equal(older.json().error, 'STALE_PUSH');
  assert.equal((await people(s))[0].name, 'Name KUL/T-0001', 'neither replay changed anything');
  assert.equal((await push(s, 'allowlist', [allowRow(at('owner'))], { sentAt })).statusCode, 200, 'per kind: the allowlist has its own clock');
  const p = nextSentAt();
  assert.equal((await poll(s, { sentAt: p })).statusCode, 200);
  assert.equal((await poll(s, { sentAt: p })).json().error, 'STALE_PUSH', 'a replayed poll is refused too');
  const [{ n }] = await s.asLmcs((tx) => tx`select count(*)::int as n from sync_runs where kind = 'staff'`);
  assert.equal(n, 1, 'a refused replay is not logged as a run');
});

test('the tenant is the one whose secret verifies; two verifying is refused', async () => {
  const s = await setup();
  await withTenant(T2, (tx) => tx`insert into tenants (id, name, sync_secret_env) values (${T2}, 'Other', 'SYNC_SECRET_T2')`, s.db.sql);
  assert.equal((await push(s, 'staff', [staff('KUL/T-0001')])).statusCode, 200);
  const res = await push(s, 'staff', [staff('KUL/T-0002', { name: 'Other Person' })], { secret: SECRET_T2 });
  assert.equal(res.statusCode, 200, res.body);
  const other = await withTenant(T2, (tx) => tx`select employee_code, campus_code from people`, s.db.sql);
  assert.deepEqual(other.map((r) => ({ ...r })), [{ employee_code: 'KUL/T-0002', campus_code: null }], 'T2 has no prefixes seeded');
  assert.deepEqual((await people(s)).map((r) => r.employee_code), ['KUL/T-0001'], 'LMCS untouched');

  // both tenants on the same secret: refused, nothing written anywhere
  await withTenant(T2, (tx) => tx`update tenants set sync_secret_env = 'SYNC_SECRET' where id = ${T2}`, s.db.sql);
  const both = await push(s, 'staff', [staff('KUL/T-0003')]);
  assert.equal(both.statusCode, 401);
  assert.equal(both.json().error, 'AMBIGUOUS_TENANT');
  assert.equal((await people(s)).length, 1);

  // a tenant naming any env var other than SYNC_SECRET* can never verify
  await withTenant(T2, (tx) => tx`update tenants set sync_secret_env = 'APP_ORIGIN' where id = ${T2}`, s.db.sql);
  assert.equal((await push(s, 'staff', [staff('KUL/T-0004')], { secret: ORIGIN })).json().error, 'BAD_SIGNATURE');
});
