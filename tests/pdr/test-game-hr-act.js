// node tests/pdr/test-game-hr-act.js -- W7 slice 1 (N3): gameHrAct, the Owner's hiring steps through the game.
// Runs the REAL main.gs dispatch + game-approvals.gs gate helpers + game-hr.gs; hiring.gs / hiring-appointments.gs are faked so each
// step's call (which function, which sheet row, which arguments) can be checked. Fake data only (public repo).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const KEY = 'k'.repeat(40);
const appl = (n, branches, extra) => Object.assign({
  row: n + 10, applicantId: 'T-' + String(n + 1).padStart(4, '0'), name: 'Applicant ' + n, phone: '+91 90000 0000' + n, branches,
  subjects: 'English', qualification: 'MA', status: 'Shortlisted', matchScore: 7, timestamp: '2026-11-01T05:00:00.000Z', round: 1,
  rejectReason: '', positionLabel: 'TGT: English', notes: '', appointments: [], interviewReports: [], demoReports: [], history: [], docsMissing: [],
}, extra);
const LIST = [
  appl(1, 'LMS-1 Dhalpur', { appointments: [{ id: 'AP-1', kind: 'interview', start: '2099-01-01T05:00:00.000Z', status: 'proposed', reportFiled: false }] }),
  appl(2, 'LMS-2 Kelheli', { status: 'Rejected', stageMarks: { rejectPending: { reason: 'Demo not up to the mark', note: 'n' } } }),
];
const calls = [], tabs = {};
let boom = null;
const fake = (name) => (caller, body) => {
  if (boom) throw new Error(boom);
  calls.push([name, caller.name, JSON.parse(JSON.stringify(body))]);
  return {};
};
const h = boot({
  allowlistRows: [['Email', 'Name', 'CampusId', 'Role', 'CanApprove'],
    ['owner@lms.org.in', 'Owner Person', 'ALL', 'Owner', ''],
    ['coord@lms.org.in', 'Coord Decider', 'ALL', 'Coordinator', 'TRUE'],
    ['principal@lms.org.in', 'Principal One', 'LMS1', 'Principal', '']],
  files: ['supporting-charge', 'approvals-leave', 'approvals', 'game-approvals', 'game-hr'],
  extra: {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ GAME_KEY: KEY })[k] || null }) },
    HIR_STATUSES: ['Shortlisted', 'Interview Scheduled', 'Interview Done', 'Demo Done', 'Salary Offer', 'MD Academics Interview Scheduled', 'Hiring Approved', 'Hired', 'Rejected'],
    hirMs_: (v) => (v ? new Date(v).getTime() || 0 : 0),
    hiringApplicants_: () => ({ success: true, applicants: JSON.parse(JSON.stringify(LIST)) }),
    hiringApprovalStatus_: () => ({ success: true, campuses: [] }),
    hirWorkbook_: () => ({
      getSheetByName: (n) => tabs[n] || null,
      insertSheet: (n) => { const rows = []; tabs[n] = { rows, getLastRow: () => rows.length, appendRow: (r) => rows.push(r) }; return tabs[n]; },
    }),
    hiringShortlist_: fake('hiringShortlist_'), hiringMarkStage_: fake('hiringMarkStage_'), apptPropose_: fake('apptPropose_'),
    apptDecide_: fake('apptDecide_'), apptCancel_: fake('apptCancel_'), hiringConfirmReject_: fake('hiringConfirmReject_'), hiringRevive_: fake('hiringRevive_'),
  },
});
const act = (who, params, extra) => h.post('gameHrAct', Object.assign({ key: KEY, email: who ? who + '@lms.org.in' : null, campus: null,
  campuses: ['LMS1', 'LMS2'], params }, extra));
const data = (r) => { assert.strictEqual(r.success, true, JSON.stringify(r)); return JSON.parse(JSON.stringify(r.data)); };
const logged = () => ((tabs['Game Actions'] || { rows: [] }).rows.filter((x) => x[0] !== 'At')).map((x) => JSON.parse(JSON.stringify(x.slice(1))));

// the gate: key, Owner only, known steps, the applicant must be in the proxy's schools
assert.deepStrictEqual(act('owner', { op: 'shortlist', id: 'T-0002' }, { key: 'wrong' }), { success: false, error: 'not_authorized' });
for (const who of ['coord', 'principal', 'stranger', null]) assert.strictEqual(data(act(who, { op: 'shortlist', id: 'T-0002' })).code, 'not_authorized', String(who));
assert.strictEqual(data(act('owner', { op: 'starthire', id: 'T-0002' })).code, 'bad_input', 'Start Hiring Process is not a game step');
assert.strictEqual(data(act('owner', { op: 'shortlist', id: 'T-9999' })).code, 'not_found');
assert.strictEqual(data(act('owner', { op: 'shortlist', id: 'T-0002' }, { campuses: ['LMS2'] })).code, 'not_found', 'another school’s applicant');
assert.strictEqual(data(act('owner', { op: 'shortlist', id: 'T-0002', row: '3' }, { campuses: [] })).code, 'not_found', 'no schools = nothing');
assert.strictEqual(calls.length, 0, 'nothing reached hiring.gs');

// each step is the old page's own function, on the applicant's row (never a row from the client)
const steps = [
  [{ op: 'shortlist', id: 'T-0002', row: '99' }, ['hiringShortlist_', { row: 11, on: true }]],
  [{ op: 'unshortlist', id: 'T-0002' }, ['hiringShortlist_', { row: 11, on: false }]],
  [{ op: 'markstage', id: 'T-0002', stage: 'interview' }, ['hiringMarkStage_', { row: 11, stage: 'interview' }]],
  [{ op: 'propose', id: 'T-0002', kind: 'md', at: '2099-02-01T05:00:00.000Z' }, ['apptPropose_', { row: 11, kind: 'md', start: '2099-02-01T05:00:00.000Z' }]],
  [{ op: 'appt', id: 'T-0002', appt: 'AP-1', decision: 'accept' }, ['apptDecide_', { id: 'AP-1', decision: 'accept', note: '' }]],
  [{ op: 'appt', id: 'T-0002', appt: 'AP-1', decision: 'cancel', note: 'Clash' }, ['apptCancel_', { id: 'AP-1', note: 'Clash' }]],
  [{ op: 'confirmreject', id: 'T-0003', confirm: '1' }, ['hiringConfirmReject_', { row: 12, confirm: true }]],
  [{ op: 'confirmreject', id: 'T-0003', confirm: '0' }, ['hiringConfirmReject_', { row: 12, confirm: false }]],
  [{ op: 'revive', id: 'T-0003', note: 'Strong demo this time' }, ['hiringRevive_', { row: 12, note: 'Strong demo this time' }]],
];
for (const [params, [fn, body]] of steps) {
  const before = calls.length;
  const d = data(act('owner', params));
  assert.strictEqual(d.ok, true, JSON.stringify(params));
  assert.deepStrictEqual(calls.slice(before), [[fn, 'Owner Person', body]], JSON.stringify(params));
  assert.strictEqual(d.applicant.id, params.id, 'the fresh detail comes back');
}
assert.deepStrictEqual(logged().map((x) => x[1]), steps.map(([p]) => p.op), 'every done step is in Game Actions');
assert.deepStrictEqual(logged()[0], ['Owner Person', 'shortlist', 'T-0002']);

// the detail now carries appointment ids and a pending reject (the reason only)
const d = data(h.post('gameHrApplicant', { key: KEY, email: 'owner@lms.org.in', campuses: ['LMS1', 'LMS2'], params: { id: 'T-0003' } }));
assert.strictEqual(d.pendingReject, 'Demo not up to the mark');
assert.ok(!JSON.stringify(d).includes('"note"'), 'the clerk’s note stays in the sheet');
assert.strictEqual(data(h.post('gameHrApplicant', { key: KEY, email: 'owner@lms.org.in', campuses: ['LMS1'], params: { id: 'T-0002' } })).appointments[0].id, 'AP-1');

// an appointment must be this applicant's; refusals carry hiring.gs's plain words (unless they could hold data) and aren't logged
const n0 = logged().length;
let r = data(act('owner', { op: 'appt', id: 'T-0003', appt: 'AP-1', decision: 'accept' }));
assert.deepStrictEqual([r.ok, r.code], [false, 'refused']);
assert.match(r.say, /isn’t this applicant’s/);
boom = 'Shortlist this applicant first (a Principal\'s call)';
r = data(act('owner', { op: 'propose', id: 'T-0002', kind: 'interview', at: '2099-02-01T05:00:00.000Z' }));
assert.deepStrictEqual([r.code, r.say], ['refused', boom]);
boom = 'Call 9000000002 or mail x@lms.org.in';
assert.strictEqual(data(act('owner', { op: 'shortlist', id: 'T-0002' })).say, '', 'a message with a number or an email is not passed on');
boom = null;
assert.strictEqual(logged().length, n0, 'refused steps are not logged');

// main.gs routes gameHrAct through the existing gameHr dispatch line (no new line)
const src = require('fs').readFileSync(require('path').join(__dirname, '../../apps-script/main.gs'), 'utf8');
assert.ok(src.includes('/^gameHr[A-Z]/'));

console.log('test-game-hr-act: all passed');
