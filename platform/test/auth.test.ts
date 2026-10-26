import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { testDb, LMCS_TENANT_ID } from './helpers.ts';
import { loadPdrOracle, loadCoordOracle, type Oracle, type Rows } from './oracle.ts';
import { withTenant, type Tx } from '../src/db.ts';
import { buildServer } from '../src/server.ts';
import { resolveCaller, requireSession, assertWritable, type Caller, type GooglePayload } from '../src/auth.ts';
import { can, type ApprovalAction, type ApprovalRow } from '../src/permissions.ts';
import { LMCS_APPROVAL_RULES } from '../src/approval-rules.ts';
import { domainCounts } from '../tools/allowlist-domains.ts';

const CLIENT = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';
const ORIGIN = 'https://app.example.test';
const DOMAIN = 'example.test';
const at = (n: string) => `${n}@${DOMAIN}`;

// Synthetic people. Allowlist: Email, Name, Campus, Role, CanApprove (the Sheet's layout).
const ALLOWLIST: string[][] = [
  ['Email', 'Name', 'Campus', 'Role', 'CanApprove'],
  [at('owner'), 'Owner One', 'ALL', 'Owner', ''],
  [at('coord.yes'), 'Coord Yes', 'ALL', 'Coordinator', 'TRUE'],
  [at('coord.no'), 'Coord No', 'ALL', 'Coordinator', ''],
  [at('coord.district'), 'Coord District', 'LMS1', 'Coordinator', 'TRUE'],
  [at('principal1'), 'Principal One', 'LMS1', 'Principal', ''],
  [at('principal.teacher'), 'Principal Teacher', 'LMS2', 'Principal,Teacher', ''],
  [at('teacher1'), 'Teacher One', 'LMS1', 'Teacher', ''],
  [at('feeclerk1'), 'Clerk One', 'LMS1', 'FeeClerk', ''],
  [at('dual'), 'Dual One', 'LMS3', 'Principal', ''],     // also an Active Teaching person: the allowlist wins
  [at('odd'), 'Odd One', 'LMS1', 'Staff', ''],           // unrecognised allowlist role: refused, no fallback
];
// people: code, email, name, campus, department, active
const PEOPLE: [string, string, string, string | null, string, boolean][] = [
  ['KUL/T-0001', at('staff1'), 'Staff One', 'LMS1', 'AdminClerk', true],
  ['KUL/T-0002', at('dual'), 'Dual One', 'LMS1', 'Teaching', true],
  ['KUL/T-0003', at('odd'), 'Odd One', 'LMS1', 'Teaching', true],
  ['KUL/T-0004', at('inactive'), 'Gone One', 'LMS1', 'Teaching', false],
  ['HES/T-0005', at('head.office'), 'Head Office', null, 'Teaching', true], // no campus (HES): allowlist only
  ['KEL/T-0006', at('teacher2'), 'Teacher Two', 'LMS2', 'Teaching', true],
  ...([['Teaching', 'T-0101'], ['AdminPTI', 'T-0102'], ['AdminIT', 'T-0103'], ['AdminClerk', 'T-0104'], ['Non-Teaching', 'T-0105'],
    ['Transport', 'T-0106'], ['AdminTM', 'T-0107'], ['AdminHead', 'T-0108']] as const)
    .map(([d, c]) => [`KUL/${c}`, at(`dept.${d.toLowerCase()}`), `Dept ${d}`, 'LMS1', d, true] as [string, string, string, string, string, boolean]),
];

let db: Awaited<ReturnType<typeof testDb>>;
const payloads = new Map<string, GooglePayload>();
const fakeVerify = async (idToken: string) => payloads.get(idToken) ?? null;
const asLmcs = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(LMCS_TENANT_ID, fn, db.sql);
const setAutoSignIn = (on: boolean) => asLmcs((tx) => tx`update switches set "on" = ${on} where feature = 'staff_auto_signin'`);
// Shared state a test changes is put back in t.after, so one failing test can't leave it changed for the next.
type T = { after(fn: () => unknown): void };
const autoSignIn = async (t: T, on: boolean) => { t.after(() => setAutoSignIn(false)); await setAutoSignIn(on); };
const restoreAfter = (t: T, fn: (tx: Tx) => Promise<unknown>) => t.after(() => asLmcs(fn));

function app() {
  const a = buildServer({ sql: db.sql, config: { APP_ORIGIN: ORIGIN, GOOGLE_SIGNIN_CLIENT_ID: CLIENT }, verifyIdToken: fakeVerify });
  const guard = requireSession(db.sql);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    a.route({ method, url: '/api/test-echo', preHandler: guard, handler: async (req) => ({ caller: req.caller, target: req.viewAsTarget }) });
  }
  return a;
}
let n = 0;
async function signIn(a: ReturnType<typeof app>, email: string, extra: Partial<GooglePayload> = {}) {
  const idToken = `id-${++n}`;
  payloads.set(idToken, { aud: CLIENT, email, email_verified: true, hd: DOMAIN, ...extra });
  return a.inject({ method: 'POST', url: '/api/session', payload: { idToken } });
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

before(async () => {
  db = await testDb();
  await db.migrate();
  await asLmcs(async (tx) => {
    await tx`update tenants set allowed_domains = ${[DOMAIN]} where id = ${LMCS_TENANT_ID}`;
    for (const [email, name, campus, role, ok] of ALLOWLIST.slice(1)) {
      await tx`insert into allowlist (tenant_id, email, name, campus_code, roles, can_approve)
               values (${LMCS_TENANT_ID}, ${email}, ${name}, ${campus}, ${role.split(',')}, ${ok === 'TRUE'})`;
    }
    for (const [code, email, name, campus, dept, active] of PEOPLE) {
      await tx`insert into people (tenant_id, employee_code, auth_email, name, campus_code, department, active)
               values (${LMCS_TENANT_ID}, ${code}, ${email}, ${name}, ${campus}, ${dept}, ${active})`;
    }
  });
});
after(async () => { await db?.close(); });

// ── sign-in ──────────────────────────────────────────────────────────

test('signs in an allowlisted person: token, 30-day expiry, person shape', async () => {
  const a = app();
  const res = await signIn(a, at('principal1'));
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.match(body.token, new RegExp(`^${LMCS_TENANT_ID}\\.[A-Za-z0-9_-]{43}$`), '<tenantId>.<base64url of 32 bytes>');
  const days = (Date.parse(body.expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, `expires in 30 days, got ${days}`);
  assert.deepEqual(body.person, { email: at('principal1'), name: 'Principal One', campusId: 'LMS1', campusName: 'LMS 1',
    role: 'Principal', roles: ['Principal'], employeeCode: null });
  const rows = await asLmcs((tx) => tx`select token_hash, person_email from sessions where token_hash = ${hashOf(body.token)}`);
  assert.equal(rows.length, 1, 'only the sha256 of the token is stored');
  assert.equal(rows[0].person_email, at('principal1'));
  const me = await a.inject({ method: 'GET', url: '/api/session', headers: bearer(body.token) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().person.role, 'Principal');
  await a.close();
});

test('rejects token for another audience', async () => {
  const a = app();
  assert.equal((await signIn(a, at('owner'), { aud: 'someone-else.apps.googleusercontent.com' })).statusCode, 401);
  payloads.clear();
  assert.equal((await a.inject({ method: 'POST', url: '/api/session', payload: { idToken: 'not-a-token' } })).statusCode, 401);
  assert.equal((await a.inject({ method: 'POST', url: '/api/session', payload: {} })).statusCode, 400);
  await a.close();
});

test('rejects unverified email', async () => {
  const a = app();
  assert.equal((await signIn(a, at('owner'), { email_verified: false })).statusCode, 401);
  assert.equal((await signIn(a, at('owner'), { email_verified: 'false' })).statusCode, 401);
  assert.equal((await signIn(a, at('owner'), { email_verified: 'true' })).statusCode, 200, 'tokeninfo-style string is accepted');
  await a.close();
});

test('rejects hd outside tenant domains', async () => {
  const a = app();
  assert.equal((await signIn(a, at('owner'), { hd: 'other.example.test' })).statusCode, 401);
  assert.equal((await signIn(a, at('owner'), { hd: undefined })).statusCode, 401, 'a consumer account has no hd');
  const none = await asLmcs((tx) => resolveCaller(tx, at('owner'), 'other.example.test'));
  assert.equal(none, null);
  await a.close();
});

test('allowlist role wins over department role', async (t) => {
  await autoSignIn(t, true);
  const dual = await asLmcs((tx) => resolveCaller(tx, at('dual'), DOMAIN));
  assert.deepEqual([dual?.roles, dual?.campusId, dual?.employeeCode], [['Principal'], 'LMS3', 'KUL/T-0002']);
  assert.equal(await asLmcs((tx) => resolveCaller(tx, at('odd'), DOMAIN)), null, 'an allowlist row with no recognised role is refused, never falls back');
  const multi = await asLmcs((tx) => resolveCaller(tx, at('principal.teacher'), DOMAIN));
  assert.deepEqual(multi?.roles, ['Principal', 'Teacher']);
  const coord = await asLmcs((tx) => resolveCaller(tx, at('coord.yes'), DOMAIN));
  assert.equal(coord?.canApprove, true);
  assert.equal((await asLmcs((tx) => resolveCaller(tx, at('coord.no'), DOMAIN)))?.canApprove, false);
});

test('department rules give Teacher/Staff/none', async (t) => {
  await autoSignIn(t, true);
  const want: Record<string, string | null> = { Teaching: 'Teacher', AdminPTI: 'Teacher', AdminIT: 'Teacher', AdminClerk: 'Staff',
    'Non-Teaching': 'Staff', Transport: 'Staff', AdminTM: null, AdminHead: null };
  for (const [dept, role] of Object.entries(want)) {
    const c = await asLmcs((tx) => resolveCaller(tx, at(`dept.${dept.toLowerCase()}`), DOMAIN));
    assert.deepEqual(c && c.roles, role && [role], dept);
    if (c) assert.deepEqual([c.campusId, c.canApprove, c.viewAs], ['LMS1', false, false]);
  }
  assert.equal(await asLmcs((tx) => resolveCaller(tx, at('head.office'), DOMAIN)), null, 'no campus: allowlist only');
  assert.equal(await asLmcs((tx) => resolveCaller(tx, at('nobody'), DOMAIN)), null);
});

test('auto roles only when staff_auto_signin is on', async (t) => {
  const a = app();
  await setAutoSignIn(false);
  assert.equal((await signIn(a, at('staff1'))).statusCode, 401);
  assert.equal((await signIn(a, at('owner'))).statusCode, 200, 'the allowlist does not depend on the switch');
  await autoSignIn(t, true);
  const res = await signIn(a, at('staff1'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().person, { email: at('staff1'), name: 'Staff One', campusId: 'LMS1', campusName: 'LMS 1',
    role: 'Staff', roles: ['Staff'], employeeCode: 'KUL/T-0001' });
  // a campus-scoped switch row turns it on for that campus only
  await setAutoSignIn(false);
  restoreAfter(t, (tx) => tx`delete from switches where scope_kind = 'campus'`);
  await asLmcs((tx) => tx`insert into switches (tenant_id, feature, scope_kind, scope_id, "on") values (${LMCS_TENANT_ID}, 'staff_auto_signin', 'campus', 'LMS2', true)`);
  assert.equal((await signIn(a, at('staff1'))).statusCode, 401, 'LMS1 still off');
  assert.equal((await signIn(a, at('teacher2'))).statusCode, 200, 'LMS2 on');
  await a.close();
});

test('inactive person refused', async (t) => {
  await autoSignIn(t, true);
  const a = app();
  assert.equal((await signIn(a, at('inactive'))).statusCode, 401);
  // an Active person signed in, then deactivated by the sync: the next request is refused
  const { token } = (await signIn(a, at('teacher2'))).json();
  assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode, 200);
  restoreAfter(t, (tx) => tx`update people set active = true where employee_code = 'KEL/T-0006'`);
  await asLmcs((tx) => tx`update people set active = false where employee_code = 'KEL/T-0006'`);
  assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode, 401);
  await a.close();
});

test('sliding expiry extends last_seen and expires_at', async () => {
  const a = app();
  const { token } = (await signIn(a, at('owner'))).json();
  const h = hashOf(token);
  const read = async () => (await asLmcs((tx) => tx`select last_seen_at, expires_at from sessions where token_hash = ${h}`))[0];
  // seen 10 minutes ago: no write (at most once an hour)
  await asLmcs((tx) => tx`update sessions set last_seen_at = now() - interval '10 minutes', expires_at = now() + interval '5 days' where token_hash = ${h}`);
  const before1 = await read();
  assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode, 200);
  assert.deepEqual(await read(), before1);
  // seen 2 hours ago: moved to now + 30 days
  await asLmcs((tx) => tx`update sessions set last_seen_at = now() - interval '2 hours', expires_at = now() + interval '5 days' where token_hash = ${h}`);
  assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode, 200);
  const after1 = await read();
  assert.ok(Date.now() - after1.last_seen_at.getTime() < 60000, 'last_seen_at is now');
  const days = (after1.expires_at.getTime() - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, `expires_at moved to 30 days, got ${days}`);
  // expired: refused
  await asLmcs((tx) => tx`update sessions set expires_at = now() - interval '1 second' where token_hash = ${h}`);
  assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode, 401);
  await a.close();
});

test('revoked token refused', async () => {
  const a = app();
  const { token } = (await signIn(a, at('owner'))).json();
  assert.equal((await a.inject({ method: 'DELETE', url: '/api/session', headers: bearer(token) })).statusCode, 200);
  assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode, 401);
  const [r] = await asLmcs((tx) => tx`select revoked_at from sessions where token_hash = ${hashOf(token)}`);
  assert.ok(r.revoked_at instanceof Date);
  // malformed / foreign-tenant / missing tokens
  const random = token.split('.')[1];
  for (const t of ['', 'garbage', `not-a-uuid.${random}`, `00000000-0000-4000-8000-0000000000ff.${random}`]) {
    assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(t) })).statusCode, 401, JSON.stringify(t));
  }
  assert.equal((await a.inject({ method: 'GET', url: '/api/session' })).statusCode, 401);
  await a.close();
});

test('view-as refuses every write', async () => {
  const a = app();
  const { token } = (await signIn(a, at('owner'))).json();
  const h = bearer(token);
  const on = await a.inject({ method: 'POST', url: '/api/session/view-as', headers: h, payload: { employeeCode: 'KEL/T-0006' } });
  assert.equal(on.statusCode, 200);
  const echo = await a.inject({ method: 'GET', url: '/api/test-echo', headers: h });
  assert.equal(echo.statusCode, 200);
  const c: Caller = echo.json().caller;
  // req.caller: the REAL signed-in Owner, flagged (Approvals keep the real caller, as PDR does)
  assert.deepEqual([c.email, c.campusId, c.roles, c.canApprove, c.viewAs], [at('owner'), 'ALL', ['Owner'], false, true]);
  // req.viewAsTarget: pdrResolveViewAsCaller_'s caller, for the "my..." views: the viewer's email, the employee's campus and code
  const v: Caller = echo.json().target;
  assert.deepEqual([v.email, v.campusId, v.roles, v.employeeCode, v.canApprove, v.viewAs], [at('owner'), 'LMS2', ['Teacher'], 'KEL/T-0006', false, true]);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    const res = await a.inject({ method, url: '/api/test-echo', headers: h, payload: {} });
    assert.equal(res.statusCode, 403, method);
    assert.deepEqual(res.json(), { ok: false, error: 'VIEW_AS_READ_ONLY' });
  }
  assert.throws(() => assertWritable(c), (e: Error & { code?: string }) => e.code === 'VIEW_AS_READ_ONLY');
  assert.doesNotThrow(() => assertWritable({ ...c, viewAs: false }));
  // leaving view-as is allowed and restores the real caller
  assert.equal((await a.inject({ method: 'DELETE', url: '/api/session/view-as', headers: h })).statusCode, 200);
  const back = (await a.inject({ method: 'POST', url: '/api/test-echo', headers: h, payload: {} })).json();
  assert.deepEqual([back.caller.roles, back.caller.viewAs, back.target], [['Owner'], false, null]);
  // who may view as whom (pdrViewAsScope_): a Teacher nobody, a one-school Principal only their own school
  const teacher = (await signIn(a, at('teacher1'))).json().token;
  assert.equal((await a.inject({ method: 'POST', url: '/api/session/view-as', headers: bearer(teacher), payload: { employeeCode: 'KEL/T-0006' } })).statusCode, 403);
  const principal = (await signIn(a, at('principal1'))).json().token;
  assert.equal((await a.inject({ method: 'POST', url: '/api/session/view-as', headers: bearer(principal), payload: { employeeCode: 'KEL/T-0006' } })).statusCode, 403, 'LMS2 employee');
  assert.equal((await a.inject({ method: 'POST', url: '/api/session/view-as', headers: bearer(principal), payload: { employeeCode: 'KUL/T-0001' } })).statusCode, 200, 'own school');
  assert.equal((await a.inject({ method: 'POST', url: '/api/session/view-as', headers: h, payload: { employeeCode: 'KUL/T-0004' } })).statusCode, 404, 'inactive employee');
  await a.close();
});

test('view-as is re-authorised on every request: a demoted viewer drops out of it', async (t) => {
  const a = app();
  const { token } = (await signIn(a, at('principal1'))).json();
  const h = bearer(token);
  assert.equal((await a.inject({ method: 'POST', url: '/api/session/view-as', headers: h, payload: { employeeCode: 'KUL/T-0001' } })).statusCode, 200);
  assert.equal((await a.inject({ method: 'GET', url: '/api/test-echo', headers: h })).json().caller.viewAs, true);
  restoreAfter(t, (tx) => tx`update allowlist set roles = '{Principal}' where email = ${at('principal1')}`);
  await asLmcs((tx) => tx`update allowlist set roles = '{Teacher}' where email = ${at('principal1')}`);
  const echo = (await a.inject({ method: 'GET', url: '/api/test-echo', headers: h })).json();
  assert.deepEqual([echo.caller.roles, echo.caller.viewAs, echo.target], [['Teacher'], false, null]);
  const [s] = await asLmcs((tx) => tx`select view_as from sessions where token_hash = ${hashOf(token)}`);
  assert.equal(s.view_as, null, 'view-as cleared on the session');
  assert.equal((await a.inject({ method: 'POST', url: '/api/test-echo', headers: h, payload: {} })).statusCode, 200, 'writes as themselves again');
  // a one-school Principal whose viewed employee moves to another school also drops out
  await asLmcs((tx) => tx`update allowlist set roles = '{Principal}' where email = ${at('principal1')}`);
  assert.equal((await a.inject({ method: 'POST', url: '/api/session/view-as', headers: h, payload: { employeeCode: 'KUL/T-0001' } })).statusCode, 200);
  restoreAfter(t, (tx) => tx`update people set campus_code = 'LMS1' where employee_code = 'KUL/T-0001'`);
  await asLmcs((tx) => tx`update people set campus_code = 'LMS2' where employee_code = 'KUL/T-0001'`);
  assert.equal((await a.inject({ method: 'GET', url: '/api/test-echo', headers: h })).json().caller.viewAs, false);
  await a.close();
});

test('allowlist row deleted: the next request is refused', async (t) => {
  const a = app();
  const { token } = (await signIn(a, at('coord.no'))).json();
  assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode, 200);
  const [row] = await asLmcs((tx) => tx`select * from allowlist where email = ${at('coord.no')}`);
  restoreAfter(t, (tx) => tx`insert into allowlist ${tx(row)}`);
  await asLmcs((tx) => tx`delete from allowlist where email = ${at('coord.no')}`);
  assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode, 401);
  await a.close();
});

test('domain removed from the tenant: existing sessions are refused', async (t) => {
  const a = app();
  const { token } = (await signIn(a, at('owner'))).json();
  restoreAfter(t, (tx) => tx`update tenants set allowed_domains = ${[DOMAIN]} where id = ${LMCS_TENANT_ID}`);
  await asLmcs((tx) => tx`update tenants set allowed_domains = '{lms.org.in}' where id = ${LMCS_TENANT_ID}`);
  assert.equal((await a.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode, 401);
  await a.close();
});

test('allowlist-domains tool counts domains, never addresses', async () => {
  await asLmcs((tx) => tx`insert into allowlist (tenant_id, email, roles) values (${LMCS_TENANT_ID}, 'someone@other.example.test', '{Owner}')`);
  const counts = await domainCounts(db.sql);
  assert.deepEqual(counts, [
    { tenant: 'LMCS', domain: DOMAIN, count: ALLOWLIST.length - 1, allowed: true },
    { tenant: 'LMCS', domain: 'other.example.test', count: 1, allowed: false },
  ]);
  assert.ok(!JSON.stringify(counts).includes('someone'), 'no addresses');
  await asLmcs((tx) => tx`delete from allowlist where email = 'someone@other.example.test'`);
});

// ── permission parity with Apps Script ──────────────────────────────

const CALLERS = ['owner', 'coord.yes', 'coord.no', 'coord.district', 'principal1', 'principal.teacher', 'teacher1', 'staff1', 'feeclerk1'].map(at);
const REQUESTERS = ['teacher1', 'principal1', 'staff1', 'other'].map(at);
const PRINCIPAL_TYPES = ['Casual Leave']; // a future APR_LEAVE_PRINCIPAL_TYPES, so the Principal leave path is exercised too
const NOT_LISTED_TYPE = 'Special Day Leave';
// Refusals: an error that says "not you". Anything else the oracle returns past these is a validation of the input
// (the caller got through), and must be one of VALIDATION so an unexpected error can't hide a later permission check.
const DENY = /^(Not authorized|Only Principals and Teachers|Teachers can only submit|Leave requests are filed by teachers|You can only delete your own|This only applies to|Only the principal who raised|The Owner decides directly|Only the Owner, or a Coordinator)/;
const VALIDATION = new Set(['This request was already decided.', 'Choose a leave type.']);
const EMP_TABS: Record<string, Rows> = {
  EmpPersonal: [['EmployeeCode', 'AuthEmail'], ...PEOPLE.map((p) => [p[0], p[1]])],
  EmpMaster: [['EmployeeCode', 'Name', 'Status', 'SchoolCode'], ...PEOPLE.map((p) => [p[0], p[2], p[5] ? 'Active' : 'Inactive', p[3] || ''])],
  EmpSalary: [['EmployeeCode', 'Department'], ...PEOPLE.map((p) => [p[0], p[4]])],
};

type Row = ApprovalRow & { id: string };
function sheetRow(r: Row): unknown[] {
  const v: unknown[] = new Array(33).fill('');
  Object.assign(v, { 0: r.id, 1: r.campusId, 2: r.category, 3: 'Normal', 4: 'A title', 5: 'A description', 11: r.requestedBy,
    12: new Date(Date.UTC(2026, 9, 1)), 13: r.status, 25: r.leaveType || '' });
  if (r.category === LMCS_APPROVAL_RULES.hiringCategory) v[10] = 'Looking for Backup for: Person One';
  return v;
}
const tabsFor = (r: Row): Record<string, Rows> => ({
  Approvals: [['id'], sheetRow(r)],
  Comments: [['id', 'approvalId', 'authorEmail', 'authorRole', 'body', 'postedAt'], ['cmt-1', r.id, r.requestedBy, 'Teacher', 'hello', new Date()]],
  Tasks: [['TaskId']],
  ...EMP_TABS,
});

type Call = (o: ReturnType<typeof loadPdrOracle>, email: string, r: Row) => any;
const PDR_CALLS: Partial<Record<ApprovalAction, Call>> = {
  list: (o, e, r) => { const res = o.get(e, 'approvalslist'); return res.success ? { success: res.requests.some((q: { id: string }) => q.id === r.id) } : res; },
  detail: (o, e, r) => o.get(e, 'approvaldetail', { id: r.id }),
  submit: (o, e, r) => o.post(e, { action: 'submitapproval', category: r.category, title: 'New', description: 'Why', campusId: r.campusId }),
  comment: (o, e, r) => o.post(e, { action: 'addapprovalcomment', approvalId: r.id, body: 'A comment' }),
  deleteComment: (o, e) => o.post(e, { action: 'deleteapprovalcomment', id: 'cmt-1' }),
  decide: (o, e, r) => o.post(e, { action: 'decideapproval', id: r.id, decision: 'Rejected', note: 'A note' }),
  archive: (o, e, r) => { const res = o.post(e, { action: 'archiveapproval', ids: [r.id], archive: false }); return res.success ? { success: res.count === 1 } : res; },
  changeHiringReason: (o, e, r) => o.post(e, { action: 'changehiringreason', id: r.id, lastWorkingDay: '2026-12-31' }),
  closeHiring: (o, e, r) => o.post(e, { action: 'closehiring', id: r.id, note: 'Withdrawn' }),
};
const COORD_CALLS: Partial<Record<ApprovalAction, Call>> = {
  allocate: (o, e, r) => o.post(e, { action: 'coordinatorallocate', approvalId: r.id, cancel: true }),
  recommend: (o, e, r) => o.post(e, { action: 'coordinatorrecommend', approvalId: r.id, recommendation: 'Approve', reason: 'Fine' }),
  decision: (o, e, r) => o.get(e, 'coordinatordecision', { id: r.id }),
};
const unknownErrors = new Set<string>();
function allowed(res: any): boolean {
  if (res.success === true) return true;
  if (res.success === false && res.error === undefined) return false; // list/archive: the row was not in scope
  if (DENY.test(String(res.error))) return false;
  if (!VALIDATION.has(res.error)) unknownErrors.add(String(res.error));
  return true;
}

test('can() matches the PDR oracle for every role × action × row', async (t) => {
  await autoSignIn(t, true);
  // the Roster proxy's action=employees, which pdrResolveViewAsCaller_ reads
  const roster = PEOPLE.filter((p) => p[5] && p[3]).map((p) => ({ employeeCode: p[0], name: p[2], school: 'LMS ' + p[3]!.slice(3) }));
  const fx = { allowlist: ALLOWLIST, tabs: EMP_TABS, props: { STAFF_AUTO_SIGNIN: 'on' },
    fetch: (url: string) => (url.endsWith('?action=employees') ? { code: 200, body: { success: true, employees: roster } } : undefined) };
  const pdr = loadPdrOracle(fx);
  const pdrFuture = loadPdrOracle({ ...fx, consts: { APR_LEAVE_PRINCIPAL_TYPES: PRINCIPAL_TYPES } });
  const coord = loadCoordOracle(fx);
  const future = { ...LMCS_APPROVAL_RULES, leavePrincipalTypes: PRINCIPAL_TYPES };

  // the seed data is today's Apps Script values, verbatim (JSON clone: vm-realm objects have other prototypes)
  assert.deepEqual(LMCS_APPROVAL_RULES, JSON.parse(JSON.stringify({
    teacherCategories: pdr.top('APR_TEACHER_CATEGORIES'), leaveCategory: pdr.top('APR_LEAVE_CATEGORY'),
    leavePrincipalTypes: pdr.top('APR_LEAVE_PRINCIPAL_TYPES'), hiringCategory: pdr.top('APR_HIRING_CATEGORY'),
    districts: coord.top('COORD_DISTRICTS'),
  })));
  assert.ok(pdr.top('APR_LV_TYPE_NAMES').includes(PRINCIPAL_TYPES[0]) && pdr.top('APR_LV_TYPE_NAMES').includes(NOT_LISTED_TYPE));

  // the platform's callers equal the ones Apps Script derives
  const callers = new Map<string, Caller>();
  for (const email of CALLERS) {
    const c = await asLmcs((tx) => resolveCaller(tx, email, DOMAIN));
    assert.ok(c, email);
    const g = JSON.parse(JSON.stringify(pdr.as(email).ctx.verifyCallerToken_('tok-' + email)));
    assert.deepEqual([c.roles, c.campusId, c.canApprove], [g.roles, g.campusId, g.canApprove], email);
    if (g.employeeCode) assert.equal(c.employeeCode, g.employeeCode, email);
    callers.set(email, c);
  }
  // view-as subjects (R9): the oracle gets viewAsCode on every call; can() gets the caller the approvals handlers see,
  // i.e. req.caller from the real session hook while view-as is on
  const subjects: { key: string; email: string; viewAsCode?: string }[] = CALLERS.map((email) => ({ key: email, email }));
  const a = app();
  for (const [viewer, code] of [['owner', 'KEL/T-0006'], ['coord.no', 'KUL/T-0001'], ['principal1', 'KUL/T-0001']]) {
    const email = at(viewer), key = `${email} viewing ${code}`;
    const h = bearer((await signIn(a, email)).json().token);
    assert.equal((await a.inject({ method: 'POST', url: '/api/session/view-as', headers: h, payload: { employeeCode: code } })).statusCode, 200, key);
    const seen = (await a.inject({ method: 'GET', url: '/api/test-echo', headers: h })).json();
    assert.equal(seen.caller.viewAs, true, key);
    callers.set(key, seen.caller);
    subjects.push({ key, email, viewAsCode: code });
    // the oracle really does resolve this viewAsCode (for the "my..." views), to the same person as req.viewAsTarget
    const resolved = JSON.parse(JSON.stringify(pdr.as(email).ctx.pdrResolveViewAsCaller_(pdr.ctx.verifyCallerToken_('tok-' + email), code)));
    assert.deepEqual([resolved.employeeCode, resolved.campusId, resolved.roles], [seen.target.employeeCode, seen.target.campusId, seen.target.roles], key);
  }
  await a.close();
  const viaViewAs = (o: Oracle, code?: string): Oracle => (!code ? o : { ...o,
    get: (e, action, params = {}) => o.get(e, action, { ...params, viewAsCode: code }),
    post: (e, body) => o.post(e, { ...body, viewAsCode: code }) });

  const rows: Row[] = [];
  for (const category of pdr.top('APR_CATEGORIES') as string[]) {
    for (const leaveType of category === LMCS_APPROVAL_RULES.leaveCategory ? [PRINCIPAL_TYPES[0], NOT_LISTED_TYPE] : [undefined]) {
      for (const campusId of ['LMS1', 'LMS2']) for (const status of ['Pending', 'Approved']) for (const requestedBy of REQUESTERS) {
        rows.push({ id: `apr-${rows.length + 1}`, campusId, category, status, requestedBy, leaveType });
      }
    }
  }
  const mismatches: string[] = [];
  const anyAllowed = new Map<string, boolean>();
  let checks = 0;
  const check = (o: ReturnType<typeof loadPdrOracle>, calls: Partial<Record<ApprovalAction, Call>>, r: Row, rules = LMCS_APPROVAL_RULES) => {
    for (const [action, call] of Object.entries(calls) as [ApprovalAction, Call][]) {
      for (const { key, email, viewAsCode } of subjects) {
        o.reset(tabsFor(r));
        const want = allowed(call(viaViewAs(o, viewAsCode), email, r));
        const got = can(callers.get(key)!, action, { ...r, authorEmail: r.requestedBy }, rules);
        checks++;
        if (got !== want) mismatches.push(`${key} ${action} ${r.category}${r.leaveType ? '/' + r.leaveType : ''} ${r.campusId} ${r.status} by ${r.requestedBy}: oracle ${want}, can ${got}`);
        if (rules === LMCS_APPROVAL_RULES && want) anyAllowed.set(`${key} ${action}`, true);
      }
    }
  };
  for (const r of rows) {
    check(pdr, PDR_CALLS, r);
    check(coord, COORD_CALLS, r);
    if (r.category === LMCS_APPROVAL_RULES.leaveCategory) check(pdrFuture, PDR_CALLS, r, future);
  }
  // actions without a row are exact; for row actions, can(caller, action) is the gate: never narrower than some row it allows
  for (const { key, email, viewAsCode } of subjects) {
    const c = callers.get(key)!;
    pdr.reset(tabsFor(rows[0])); coord.reset(tabsFor(rows[0]));
    const p = viaViewAs(pdr, viewAsCode), k = viaViewAs(coord, viewAsCode);
    for (const [action, want] of [['referees', allowed(p.get(email, 'approvalreferees'))], ['trackRecord', allowed(k.get(email, 'coordinatortrackrecord'))]] as const) {
      checks++;
      if (can(c, action) !== want) mismatches.push(`${key} ${action}: oracle ${want}, can ${can(c, action)}`);
    }
    for (const action of [...Object.keys(PDR_CALLS), ...Object.keys(COORD_CALLS)] as ApprovalAction[]) {
      if (anyAllowed.get(`${key} ${action}`) && !can(c, action)) mismatches.push(`${key} ${action} (no row): oracle allows a row, can refuses`);
    }
  }
  assert.deepEqual([...unknownErrors], [], 'every oracle error is a known refusal or validation');
  assert.equal(mismatches.length, 0, `${mismatches.length} of ${checks} differ:\n${mismatches.slice(0, 30).join('\n')}`);
  assert.ok(checks > 30000, `matrix ran ${checks} checks`);
  console.log(`# parity: ${checks} checks, ${subjects.length} callers (${subjects.length - CALLERS.length} in view-as), ${mismatches.length} differences`);
});
