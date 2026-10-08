// Teacher Portal access rules: who may open it, who may "view as" whom.
// Runs the real apps-script/main.gs (server boundary) and assets/auth.js (UI mirror) in a sandbox.
// Usage: node tests/teacher-portal/test-view-as.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '../..');

// ── server: main.gs ────────────────────────────────────────────────
const ROSTER = [
  { employeeCode: 'KEL/1', name: 'Kelheli Teacher', school: 'LMS 2' },
  { employeeCode: 'JOG/1', name: 'Jogindernagar Teacher', school: 'LMS 6' },
  { employeeCode: 'HES/1', name: 'No School', school: null },
];
const gas = {
  console, UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: true, employees: ROSTER }) }) },
  TP_EMPLOYEE_ROSTER_URL: 'https://roster.test/exec',
  CacheService: {}, SpreadsheetApp: {}, ContentService: {}, MailApp: {},
};
vm.createContext(gas);
try { vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/main.gs'), 'utf8'), gas); }
catch (e) { console.error('main.gs failed to load in the sandbox (a new top-level reference needs a stub):', e.message); process.exit(1); }

const caller = (roles, campusId, email = 'x@lms.org.in') => ({ email, campusId, role: roles.join(','), roles });
const scope = (c) => gas.pdrViewAsScope_(c);
assert.strictEqual(scope(caller(['Owner'], 'ALL')), 'network');
assert.strictEqual(scope(caller(['Coordinator'], 'LMS3')), 'network', 'a campus-locked Coordinator is still network-wide');
assert.strictEqual(scope(caller(['Principal'], 'ALL')), 'network', 'a network-wide Principal');
assert.strictEqual(scope(caller(['Principal'], 'LMS2')), 'school');
assert.strictEqual(scope(caller(['Teacher'], 'LMS2')), null, 'a plain Teacher cannot view as anyone');
assert.strictEqual(scope(caller(['Teacher'], 'ALL')), null, 'campusId ALL alone grants nothing to a Teacher');
assert.strictEqual(scope(caller(['Teacher', 'Principal'], 'LMS2')), 'school', 'multi-role: highest wins');

const view = (c, code) => gas.pdrResolveViewAsCaller_(c, code);
// Owner / Coordinator: any school
assert.strictEqual(view(caller(['Owner'], 'ALL'), 'JOG/1').employeeCode, 'JOG/1');
assert.strictEqual(view(caller(['Coordinator'], 'LMS2'), 'JOG/1').employeeCode, 'JOG/1');
// Principal: own school yes, other school no (gets their own identity back, unchanged)
const p2 = caller(['Principal'], 'LMS2');
assert.strictEqual(view(p2, 'KEL/1').employeeCode, 'KEL/1');
assert.strictEqual(view(p2, 'KEL/1').campusId, 'LMS2');
assert.strictEqual(view(p2, 'JOG/1'), p2, 'another school is silently ignored');
// network-wide Principal: any school
assert.strictEqual(view(caller(['Principal'], 'ALL'), 'JOG/1').employeeCode, 'JOG/1');
// Teacher: ignored; unknown code / no school: ignored
const t = caller(['Teacher'], 'LMS2');
assert.strictEqual(view(t, 'KEL/1'), t);
assert.strictEqual(view(caller(['Owner'], 'ALL'), 'NOPE').employeeCode, undefined);
assert.strictEqual(view(caller(['Owner'], 'ALL'), 'HES/1').employeeCode, undefined);
// the viewed identity is read-only: never an approver, and carries who is viewing
const v = view(caller(['Owner'], 'ALL', 'boss@lms.org.in'), 'KEL/1');
assert.strictEqual(v.canApprove, false);
assert.strictEqual(v.viewedAsBy, 'boss@lms.org.in');
assert.strictEqual(JSON.stringify(v.roles), '["Teacher"]');
// no viewAsCode: caller returned untouched
assert.strictEqual(view(p2, undefined), p2);

// ── UI mirror: auth.js ─────────────────────────────────────────────
const store = {};
const ui = {
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, key: () => null, length: 0 },
  URL, Response, console, setTimeout: () => 0, clearTimeout() {}, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  location: { href: 'https://portal.test/x/' }, navigator: {}, performance: { getEntriesByType: () => [{ type: 'navigate' }] },
  document: { readyState: 'loading', getElementById: () => null, hidden: false, addEventListener() {}, body: null },
  fetch: async () => new Response('{"success":true}'),
};
ui.window = ui; ui.addEventListener = () => {};
vm.createContext(ui);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/auth.js'), 'utf8'), ui);
const L = ui.window.LMCS;
const sess = (role, campusId) => ({ email: 'x@lms.org.in', role, campusId });
for (const [role, campus, open, sc] of [
  ['Teacher', 'LMS1', true, null], ['Principal', 'LMS1', true, 'school'], ['Principal', 'ALL', true, 'network'],
  ['Coordinator', 'LMS4', true, 'network'], ['Owner', 'ALL', true, 'network'], ['Coordinator,Teacher', 'LMS2', true, 'network'],
  ['', 'LMS1', false, null],
]) {
  assert.strictEqual(L.canViewTeacherPortal(sess(role, campus)), open, role + '/' + campus + ' open');
  assert.strictEqual(L.viewAsScope(sess(role, campus)), sc, role + '/' + campus + ' scope');
  // the server and UI must agree
  if (role) assert.strictEqual(gas.pdrViewAsScope_(caller(role.split(','), campus)), sc, 'server/UI disagree for ' + role + '/' + campus);
}

// view-as responses are never cached (a rejected one must not stick)
store.lmcs_session = JSON.stringify({ email: 'a@lms.org.in', expiresAt: Date.now() + 3600e3 });
async function hit() {
  const c = { n: 0 };
  const env = Object.assign({}, ui, { fetch: async () => { c.n++; return new Response('{"success":true,"employeeCode":"X"}'); } });
  env.window = env; env.addEventListener = () => {};
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/auth.js'), 'utf8'), env);
  await env.window.fetch('https://script.google.com/macros/s/AAA/exec?action=myemployeecode&viewAsCode=KEL%2F1&idToken=t');
  return c.n;
}
(async () => {
  assert.strictEqual(await hit(), 1, 'first view-as call hits the network');
  assert.strictEqual(await hit(), 1, 'second view-as call (new page) must hit the network again, not the cache');
  console.log('teacher-portal view-as: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
