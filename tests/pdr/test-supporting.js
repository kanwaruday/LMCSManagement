// A Principal's supporting charge (apps-script/supporting-charge.gs) as the PDR backend applies it (main.gs doGet/doPost):
// reading a supported school, never ALL or a school not on their row, and every decision refused server-side there.
// Usage: node tests/pdr/test-supporting.js. Synthetic people only.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { boot } = require('./harness');

// ── the shared rules, alone ──────────────────────────────────────────
const S = {}; vm.createContext(S);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/supporting-charge.gs'), 'utf8'), S);
const H = ['Email', 'Name', 'Campus', 'Roles', 'CanApprove', 'Functions', 'Supporting'];
const sch = (row) => Array.from(S.supportSchools_(H, row));
assert.deepStrictEqual(sch(['p@x', 'P', 'LMS4', 'Principal', '', '', 'lms3, ALL, LMS4, LMS9, LMS1, LMS3']), ['LMS1', 'LMS3'], 'LMS1-6 order; ALL, own school, unknown and repeats dropped');
assert.deepStrictEqual(sch(['p@x', 'P', 'LMS4', 'Principal, Teacher', '', '', 'LMS2']), ['LMS2'], 'a Principal with another school-level role');
for (const roles of ['Owner, Principal', 'Principal, Coordinator', 'Teacher', 'FeeClerk']) assert.deepStrictEqual(sch(['p@x', 'P', 'LMS4', roles, '', '', 'LMS2']), [], roles + ': none');
assert.deepStrictEqual(sch(['p@x', 'P', 'ALL', 'Principal', '', '', 'LMS2']), [], 'a Principal at ALL: none');
assert.deepStrictEqual(Array.from(S.supportSchools_(H.slice(0, 6), ['p@x', 'P', 'LMS4', 'Principal', '', '', 'LMS2'])), [], 'no column: none');
const c = { email: 'p@x', campusId: 'LMS4', roles: ['Principal'], canApprove: true, canDecide: true, supporting: ['LMS3'] };
assert.strictEqual(S.supportActAs_(c, undefined), c, 'no actAs: the caller as is');
assert.strictEqual(S.supportActAs_(c, ''), c);
const at = S.supportActAs_(c, 'lms3');
assert.deepStrictEqual([at.campusId, at.homeCampusId, at.supportingAt, at.canApprove, at.canDecide], ['LMS3', 'LMS4', 'LMS3', false, false]);
assert.strictEqual(c.campusId, 'LMS4', 'the real caller is untouched');
for (const bad of ['ALL', 'all', 'LMS5', 'LMS4', 'LMS7', ['LMS3'], 'LMS3,LMS5']) assert.strictEqual(S.supportActAs_(c, bad), null, 'refused: ' + JSON.stringify(bad));
assert.strictEqual(S.supportActAs_(Object.assign({}, c, { supporting: undefined }), 'LMS3'), null, 'no charge: refused');
assert.strictEqual(S.supportActAs_(null, 'LMS3'), null);

// ── the PDR backend ──────────────────────────────────────────────────
const allow = [H,
  ['p4@example.org', 'Principal Four', 'LMS4', 'Principal', '', '', 'LMS3'],
  ['p3@example.org', 'Principal Three', 'LMS3', 'Principal', '', '', ''],
  ['owner@example.org', 'Owner', 'ALL', 'Owner', 'TRUE', '', 'LMS3'],
  ['pc@example.org', 'Princ Coord', 'LMS2', 'Principal, Coordinator', 'TRUE', '', 'LMS3']];
const tokens = { p4: { email: 'p4@example.org' }, p3: { email: 'p3@example.org' }, own: { email: 'owner@example.org' }, pc: { email: 'pc@example.org' } };
const t = boot({ allowlistRows: allow, tokens });
const seen = [];
const spy = (name) => (caller) => { seen.push([name, caller.campusId, caller.supportingAt || null, caller.canApprove]); return { success: true, by: name }; };
['aprList_', 'aprDetail_', 'aprAddComment_', 'aprDeleteComment_', 'aprDecide_', 'aprSubmit_', 'aprArchive_', 'principalDrSaveDailyReport_', 'principalDrAddPlannedActivity_',
  'hiringUpdateStatus_', 'apptDecide_'].forEach((n) => { t.g[n] = spy(n); });

// reading the supported school: the caller arrives at LMS3, read-only
assert.strictEqual(t.get('approvalslist', { idToken: 'p4', actAs: 'LMS3' }).success, true);
assert.deepStrictEqual(seen.pop(), ['aprList_', 'LMS3', 'LMS3', false]);
assert.strictEqual(t.get('approvalslist', { idToken: 'p4' }).success, true);
assert.deepStrictEqual(seen.pop(), ['aprList_', 'LMS4', null, false], 'no actAs: their own school');

// never ALL, never a school not on their row, never for a row that can't hold a charge
for (const [tok, act] of [['p4', 'ALL'], ['p4', 'LMS5'], ['p4', 'LMS4'], ['p3', 'LMS4'], ['own', 'LMS3'], ['pc', 'LMS3']]) {
  const r = t.get('approvalslist', { idToken: tok, actAs: act });
  assert.strictEqual(r.code, 'SUPPORT_NOT_YOURS', tok + ' -> ' + act);
}
assert.strictEqual(seen.length, 0, 'nothing read for a refused switch');

// at the supported school: every decision and every school-owned write is refused before it runs; comments go through
for (const action of ['decideapproval', 'submitapproval', 'archiveapproval', 'savedailyreport', 'addplannedactivity', 'updatehiringstatus', 'apptdecide', 'hiringstarthire']) {
  const r = t.post(action, { idToken: 'p4', actAs: 'LMS3', id: 'APR-1', decision: 'Approved' });
  assert.strictEqual(r.code, 'SUPPORT_READ_ONLY', action + ' refused server-side');
}
assert.strictEqual(seen.length, 0, 'no handler ran');
assert.strictEqual(t.post('addapprovalcomment', { idToken: 'p4', actAs: 'LMS3', id: 'APR-1', text: 'Try the other vendor' }).success, true);
assert.deepStrictEqual(seen.pop(), ['aprAddComment_', 'LMS3', 'LMS3', false], 'advice: a comment at the supported school');
assert.strictEqual(t.post('decideapproval', { idToken: 'p4', actAs: 'ALL', id: 'APR-1' }).code, 'SUPPORT_NOT_YOURS');
// the supported school's own Principal is untouched by the charge
assert.strictEqual(t.post('decideapproval', { idToken: 'p3', id: 'APR-1' }).success, true);
assert.deepStrictEqual(seen.pop(), ['aprDecide_', 'LMS3', null, false]);
console.log('pdr supporting charge: ok');
