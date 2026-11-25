// node tests/pdr/test-game-hr-s2.js -- W7 S2 (N3, 25 Nov): the hiring room for the Principal and the Fee Clerk/PRO (game-hr.gs).
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
  appl(0, 'LMS-1 Dhalpur', { name: 'Same Name' }),
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
    ['principal@lms.org.in', 'Principal One', 'LMS1', 'Principal', ''],
    ['clerk@lms.org.in', 'Clerk One', 'LMS1', 'FeeClerk', '']],
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
    hiringShortlist_: fake('hiringShortlist_'), hiringMarkStage_: fake('hiringMarkStage_'), apptPropose_: fake('apptPropose_'), apptHeld_: fake('apptHeld_'),
    hiringSubmitInterview_: fake('hiringSubmitInterview_'), hiringSubmitDemo_: fake('hiringSubmitDemo_'), hiringDupSettle_: fake('hiringDupSettle_'),
    apptCalendarRetry_: fake('apptCalendarRetry_'),
    hiringAddApplicant_: (caller, body) => { if (boom) throw new Error(boom); calls.push(['hiringAddApplicant_', caller.name, JSON.parse(JSON.stringify(body))]);
      return body.name === 'Dup Name' ? { duplicate: true, applicantId: '' } : { duplicate: false, applicantId: 'T-0042' }; },
    apptDecide_: fake('apptDecide_'), apptCancel_: fake('apptCancel_'), hiringConfirmReject_: fake('hiringConfirmReject_'), hiringRevive_: fake('hiringRevive_'),
  },
});
const as = (role, who, params, extra) => h.post('gameHrAct', Object.assign({ key: KEY, role, email: who + '@lms.org.in', campus: null, campuses: ['LMS1'], params }, extra));
const data = (r) => { assert.strictEqual(r.success, true, JSON.stringify(r)); return JSON.parse(JSON.stringify(r.data)); };
const code = (r) => data(r).code;
const logged = () => ((tabs['Game Actions'] || { rows: [] }).rows.filter((x) => x[0] !== 'At')).map((x) => JSON.parse(JSON.stringify(x.slice(1))));

// the role must be the person's own: a Fee Clerk can't act as Principal, a Principal can't act as Owner, no role = nothing
assert.strictEqual(code(as('principal', 'clerk', { op: 'shortlist', id: 'T-0002' })), 'not_authorized');
assert.strictEqual(code(as('owner', 'principal', { op: 'shortlist', id: 'T-0002' })), 'not_authorized');
assert.strictEqual(code(as('coordinator', 'coord', { op: 'shortlist', id: 'T-0002' })), 'not_authorized', 'not a hiring-room role');
assert.strictEqual(code(as('', 'principal', { op: 'shortlist', id: 'T-0002' })), 'not_authorized');
// the Principal's steps stop short of the Owner's
for (const op of ['confirmreject', 'revive', 'starthire']) assert.strictEqual(code(as('principal', 'principal', { op, id: 'T-0002', confirm: '1' })), 'not_authorized', op);
// the Fee Clerk's legwork only: no shortlist, no report, no accept / decline
for (const p of [{ op: 'shortlist', id: 'T-0002' }, { op: 'interview', id: 'T-0002' }, { op: 'dupsettle', id: 'T-0002', other: 'T-0001' },
  { op: 'appt', id: 'T-0002', appt: 'AP-1', decision: 'accept' }, { op: 'appt', id: 'T-0002', appt: 'AP-1', decision: 'decline' }])
  assert.strictEqual(code(as('fee_clerk', 'clerk', p)), 'not_authorized', JSON.stringify(p));
assert.strictEqual(calls.length, 0, 'nothing reached hiring.gs');

// the Principal: the old page's steps, each its own function, on the applicant's row
const pr = (params) => { const n = calls.length; const d = data(as('principal', 'principal', params)); assert.strictEqual(d.ok !== false, true, JSON.stringify([params, d])); return calls.slice(n); };
assert.deepStrictEqual(pr({ op: 'shortlist', id: 'T-0002' }), [['hiringShortlist_', 'Principal One', { row: 11, on: true }]]);
assert.deepStrictEqual(pr({ op: 'interview', id: 'T-0002', recommendation: 'demo', form: JSON.stringify({ confidence: 4, english: 3, capability: { English: 4 },
  expectedSalary: '20000', row: 99, idToken: 'x', email: 'evil@x' }) }),
  [['hiringSubmitInterview_', 'Principal One', { row: 11, recommendation: 'demo', rejectReason: '', rejectNote: '', confidence: 4, english: 3, capability: { English: 4 }, expectedSalary: '20000' }]],
  'only the form’s own fields pass; the row is the applicant’s');
assert.deepStrictEqual(pr({ op: 'demo', id: 'T-0002', recommendation: 'reject', rejectReason: 'Demo not up to the mark', form: JSON.stringify({ scores: { pedagogy: 3 }, class: '5' }) }),
  [['hiringSubmitDemo_', 'Principal One', { row: 11, recommendation: 'reject', rejectReason: 'Demo not up to the mark', rejectNote: '', class: '5', scores: { pedagogy: 3 } }]]);
assert.deepStrictEqual(pr({ op: 'calretry', id: 'T-0002', appt: 'AP-1' }), [['apptCalendarRetry_', 'Principal One', { id: 'AP-1' }]]);
assert.deepStrictEqual(pr({ op: 'dupsettle', id: 'T-0001', other: 'T-0002', same: '1' }), [['hiringDupSettle_', 'Principal One', { row: 10, otherRow: 11, same: true }]]);
let r = data(as('principal', 'principal', { op: 'dupsettle', id: 'T-0001', other: 'T-0003' }));
assert.strictEqual(r.code, 'refused', 'the other candidate must be in this caller’s own list (T-0003 applied to LMS2)');
r = data(as('principal', 'principal', { op: 'calretry', id: 'T-0001', appt: 'AP-1' }));
assert.strictEqual(r.code, 'refused', 'an appointment of another applicant');
assert.strictEqual(code(as('principal', 'principal', { op: 'interview', id: 'T-0002', form: '{nope' })), 'refused');

// add an applicant: at one of the proxy's schools, only the add form's fields, a duplicate says so
const n1 = calls.length;
r = data(as('fee_clerk', 'clerk', { op: 'add', campus: 'lms1', name: 'New Person', phone: '9000000099', subjects: 'Maths', row: '5', cv: 'x' }));
assert.deepStrictEqual(r, { ok: true, id: 'T-0042' });
assert.deepStrictEqual(calls.slice(n1), [['hiringAddApplicant_', 'Clerk One', { campusId: 'LMS1', name: 'New Person', phone: '9000000099', subjects: 'Maths' }]]);
assert.strictEqual(code(as('fee_clerk', 'clerk', { op: 'add', campus: 'LMS2', name: 'X' })), 'not_found', 'not one of the proxy’s schools');
assert.deepStrictEqual(data(as('principal', 'principal', { op: 'add', campus: 'LMS1', name: 'Dup Name' })), { ok: false, code: 'duplicate', id: '' });
// the Fee Clerk: propose, record a visit already held, cancel
const fc = (params) => { const n = calls.length; assert.strictEqual(data(as('fee_clerk', 'clerk', params)).ok, true, JSON.stringify(params)); return calls.slice(n); };
assert.deepStrictEqual(fc({ op: 'propose', id: 'T-0002', kind: 'interview', at: '2099-02-01T05:00:00.000Z' }), [['apptPropose_', 'Clerk One', { row: 11, kind: 'interview', start: '2099-02-01T05:00:00.000Z' }]]);
assert.deepStrictEqual(fc({ op: 'appt', id: 'T-0002', appt: 'AP-1', decision: 'cancel', note: 'Clash' }), [['apptCancel_', 'Clerk One', { id: 'AP-1', note: 'Clash' }]]);

// reveal: a phone for the Principal and the Fee Clerk (audited, by name); the offer stays the Owner's
const rv = (role, who, field) => h.post('gameHrReveal', { key: KEY, role, email: who + '@lms.org.in', campuses: ['LMS1'], params: { id: 'T-0002', field } });
assert.strictEqual(data(rv('principal', 'principal', 'phone')).field, 'phone');
assert.strictEqual(code(rv('principal', 'principal', 'offer')), 'not_authorized');
assert.strictEqual(code(rv('fee_clerk', 'clerk', 'offer')), 'not_authorized');
const audit = tabs['Game Reveals'].rows.filter((x) => x[0] !== 'At').map((x) => x.slice(1));
assert.deepStrictEqual(JSON.parse(JSON.stringify(audit)), [['Principal One', 'phone', 'T-0002']], 'audited by name, never the value');
// the pipeline opens for both
assert.ok(Array.isArray(data(h.post('gameHrPipeline', { key: KEY, role: 'fee_clerk', email: 'clerk@lms.org.in', campuses: ['LMS1'], params: {} })).applicants));

// every done step is logged by name and step; no values
assert.ok(logged().some((x) => x[0] === 'Clerk One' && x[1] === 'add' && x[2] === 'T-0042'));
assert.ok(!JSON.stringify(tabs['Game Actions'].rows).includes('9000000099'), 'no phone in the log');
console.log('test-game-hr-s2: all passed');
