// Staff sign-in from the Employee Master: an email missing from the allowlist but Active in the Employee Master
// signs in as Teacher or Staff (by EmpSalary Department) -- only when Script property STAFF_AUTO_SIGNIN is exactly 'on'.
// Runs the real apps-script/main.gs + teacher-portal.gs + approvals.gs and assets/auth.js in a sandbox.
// Usage: node tests/teacher-portal/test-staff-signin.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '../..');

const ZW = String.fromCharCode(0x200B); // zero-width space
const top = (gas, name) => vm.runInContext(name, gas); // top-level const/let are not properties of the vm context
function makeGas(flag, deptCell) {
  const sheets = {
    EmpPersonal: [['EmployeeCode', 'AuthEmail'], ['NCM/99/01/901', 'T.One@lms.org.in'], ['NCM/24/04/074', 't.two@lms.org.in'], ['NCM/24/04/075', 't.three@lms.org.in'],
      ['HES/1', 'h.one@lms.org.in'], ['KEL/1', 'k.one@lms.org.in'], ['NCM/9', 'p.one@lms.org.in'], ['XYZ/1', 'x.one@lms.org.in']],
    EmpMaster: [['EmployeeCode', 'Name', 'Status'], ['NCM/99/01/901', 'Teacher One', 'Active'], ['NCM/24/04/074', 'Teacher Two', 'Inactive'], ['NCM/24/04/075', 'Teacher Three', ' active '],
      ['HES/1', 'Head Office', 'Active'], ['KEL/1', 'Kel One', 'Active'], ['NCM/9', 'Principal One', 'Active'], ['XYZ/1', 'Xyz One', 'Active']],
    EmpSalary: [['EmployeeCode', 'Department'], ['NCM/99/01/901', deptCell], ['NCM/24/04/074', 'Teaching'], ['NCM/24/04/075', 'Teaching'],
      ['HES/1', 'Teaching'], ['KEL/1', 'Teaching'], ['NCM/9', 'Teaching'], ['XYZ/1', 'Teaching']],
  };
  const allow = [['Email', 'Name', 'Campus', 'Role', 'CanApprove'], ['p.one@lms.org.in', 'Principal One', 'LMS4', 'Principal', '']];
  const gas = {
    console,
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'STAFF_AUTO_SIGNIN' ? flag : null) }) },
    SpreadsheetApp: { openById: (id) => (id === top(gas, 'ALLOWLIST_SHEET_ID')
      ? { getSheets: () => [{ getDataRange: () => ({ getValues: () => allow }) }] }
      : { getSheetByName: (n) => ({ getDataRange: () => ({ getValues: () => sheets[n] }) }) }) },
    Utilities: { base64EncodeWebSafe: (x) => String(x), computeDigest: (a, s) => s, DigestAlgorithm: { MD5: 'MD5' } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ aud: top(gas, 'GOOGLE_CLIENT_ID'), email_verified: 'true', email: gas.__email }) }) },
    MailApp: {},
  };
  vm.createContext(gas);
  for (const f of ['main.gs', 'teacher-portal.gs', 'approvals.gs']) {
    try { vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', f), 'utf8'), gas); }
    catch (e) { console.error(f + ' failed to load in the sandbox:', e.message); process.exit(1); }
  }
  return gas;
}
const json = (o) => JSON.parse(JSON.stringify(o));
const staffOf = (gas, email) => json(gas.pdrStaffFromEmployeeMaster_(email));
const verify = (gas, email) => { gas.__email = email; return json(gas.verifyCallerToken_('tok-' + email)); };

// ── mapping ────────────────────────────────────────────────────────
let g = makeGas('on', 'Teaching');
assert.deepStrictEqual(staffOf(g, 't.one@lms.org.in'),
  { email: 't.one@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], employeeCode: 'NCM/99/01/901' }, 'Active Teaching code -> Teacher');
assert.strictEqual(staffOf(g, 'T.ONE@LMS.ORG.IN').employeeCode, 'NCM/99/01/901', 'mixed-case email matches');
assert.strictEqual(staffOf(g, 't.two@lms.org.in'), null, 'Inactive code');
assert.strictEqual(staffOf(g, 't.three@lms.org.in').roles[0], 'Teacher', 'Status is trimmed and case-insensitive');
assert.strictEqual(staffOf(g, 'h.one@lms.org.in'), null, 'HES code -> allowlist only');
assert.strictEqual(staffOf(g, 'x.one@lms.org.in'), null, 'unknown prefix');
assert.strictEqual(staffOf(g, 'nobody@lms.org.in'), null, 'email not in EmpPersonal');
assert.strictEqual(staffOf(g, 'k.one@lms.org.in').campusId, 'LMS2', 'KEL -> LMS2');

for (const [dept, role] of [['AdminPTI', 'Teacher'], ['AdminIT', 'Teacher'], ['AdminClerk', 'Staff'], ['Non-Teaching', 'Staff'], ['Transport', 'Staff'], ['AdminTM', null], ['AdminHead', null], ['', null]]) {
  const r = staffOf(makeGas('on', dept), 't.one@lms.org.in');
  assert.strictEqual(r && r.roles[0], role, 'department ' + JSON.stringify(dept));
}
assert.strictEqual(staffOf(makeGas('on', ZW + 'AdminClerk' + ZW + ' '), 't.one@lms.org.in').roles[0], 'Staff', 'zero-width space in Department still maps');

// ── the switch: exactly 'on' ───────────────────────────────────────
for (const flag of [null, '', 'On ', 'ON', 'off', 'true']) assert.strictEqual(staffOf(makeGas(flag, 'Teaching'), 't.one@lms.org.in'), null, 'flag ' + JSON.stringify(flag));

// ── verifyCallerToken_: the allowlist always wins, the fallback only adds Teacher/Staff ──
g = makeGas('on', 'Teaching');
const p = verify(g, 'p.one@lms.org.in');
assert.deepStrictEqual([p.roles, p.campusId, !!p.autoSignIn], [['Principal'], 'LMS4', false], 'allowlisted Principal unchanged despite an Active Teaching code');
const t = verify(g, 't.one@lms.org.in');
assert.deepStrictEqual([t.roles, t.campusId, t.employeeCode, t.canApprove, t.autoSignIn], [['Teacher'], 'LMS4', 'NCM/99/01/901', false, true]);
assert.strictEqual(verify(g, 't.two@lms.org.in'), null, 'Inactive stays out');
assert.strictEqual(verify(makeGas(null, 'Teaching'), 't.one@lms.org.in'), null, 'flag off: unlisted email stays out');
assert.strictEqual(verify(makeGas('on', 'AdminTM'), 't.one@lms.org.in'), null, 'AdminTM stays out');

// ── Staff may call only the Staff lists ─────────────────────────────
const staff = verify(makeGas('on', 'AdminClerk'), 't.one@lms.org.in');
assert.deepStrictEqual(staff.roles, ['Staff']);
const allows = (c, a, post) => g.pdrLimitedAllows_(c, a, !!post);
assert.strictEqual(allows(staff, 'approvalslist'), true);
assert.strictEqual(allows(staff, 'myrankscore'), false, 'Teacher-only action refused');
assert.strictEqual(allows(staff, 'ssdashboard'), false);
assert.strictEqual(allows(staff, 'submitapproval', true), true);
assert.strictEqual(allows(staff, 'decideapproval', true), false);
assert.strictEqual(allows(t, 'myrankscore'), true, 'Teacher keeps the Teacher list');
assert.deepStrictEqual(json(top(g, 'PDR_STAFF_GET_ACTIONS')), ['approvalslist', 'approvaldetail', 'myssstats', 'myupcomingevents', 'myemployeecode']);
assert.strictEqual(g.pdrIsElevated_(staff), false);
assert.strictEqual(g.pdrIsTeacherOnly_(staff), true, 'Staff is scoped to their own requests like a Teacher');
assert.strictEqual(json(g.aprSubmit_(staff, { category: 'Not A Teacher Category' })).success, false, 'Staff cannot file a full-category request');

// ── staffsignin action ──────────────────────────────────────────────
const get = (gas, email, action) => { gas.__email = email; return gas.doGet({ parameter: { idToken: 'tok-' + email, action } }); };
assert.deepStrictEqual(json(get(g, 't.one@lms.org.in', 'staffsignin')), { success: true, role: 'Teacher', campusId: 'LMS4', employeeCode: 'NCM/99/01/901' });
assert.strictEqual(get(g, 'p.one@lms.org.in', 'staffsignin').success, false, 'an allowlisted caller gets nothing from staffsignin');
assert.strictEqual(get(makeGas(null, 'Teaching'), 't.one@lms.org.in', 'staffsignin').success, false, 'flag off');

// ── UI mirror: auth.js admits Staff to the Teacher Portal ───────────
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
assert.strictEqual(L.canViewTeacherPortal({ email: 'x@lms.org.in', role: 'Staff', campusId: 'LMS4' }), true);
assert.strictEqual(L.viewAsScope({ email: 'x@lms.org.in', role: 'Staff', campusId: 'LMS4' }), null, 'Staff cannot view as anyone');
assert.strictEqual(L.canViewTeacherSS({ email: 'x@lms.org.in', role: 'Staff', campusId: 'LMS4' }), false, 'Staff opens nothing else');

console.log('staff sign-in: all checks passed');
