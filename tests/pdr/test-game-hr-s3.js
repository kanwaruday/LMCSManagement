// node tests/pdr/test-game-hr-s3.js -- W7 S3 (N3, 25 Nov): the Offer Calculator's backend for the Owner (game-hr.gs): config, record, EPF.
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
    apptDecide_: fake('apptDecide_'),
    salaryConfig_: () => ({ success: true, payScale: [{ designation: 'TGT', preBasic: 9300, gradePay: 4200, idealHours: 36 }], jobRoleNorms: [], tuitionFees: {}, payrollRates: {}, constants: {} }),
    hiringRowNotes_: (row) => ({ success: true, notes: row === 11 ? 'Earlier note' : '', salaryOfferAt: row === 12 ? '2026-11-01T00:00:00.000Z' : '' }),
    hiringUpdateStatus_: fake('hiringUpdateStatus_'),
    salEpfExemptionApproved_: (name) => name === 'Applicant 1',
    hirText_: (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max || 1000), apptCancel_: fake('apptCancel_'), hiringConfirmReject_: fake('hiringConfirmReject_'), hiringRevive_: fake('hiringRevive_'),
  },
});
// approvals.gs loads after the fakes (harness order), so its real aprSubmit_ is swapped for a recorder here
h.g.aprSubmit_ = (caller, body) => { calls.push(['aprSubmit_', caller.name, JSON.parse(JSON.stringify(body))]); return { success: true }; };
const post = (action, role, who, params) => h.post(action, { key: KEY, role, email: who + '@lms.org.in', campus: null, campuses: ['LMS1', 'LMS2'], params });
const data = (r) => { assert.strictEqual(r.success, true, JSON.stringify(r)); return JSON.parse(JSON.stringify(r.data)); };
const B = { basic: 15194, da: 760, ada: 5318, epfE: 1771, pfE: 780, esiE: 519, totEpf: 5102, totEsi: 639, rrf: 2922, tuition: 0, cti: 24342, net: 15679,
  designation: 'TGT', subjects: 'English', lmsExp: 0, otherExp: 3 };

// Owner only: the Principal and the Fee Clerk can't reach any of the three, even with their own role
for (const a of ['gameHrSalaryConfig', 'gameHrOffer', 'gameHrEpf'])
  for (const [role, who] of [['principal', 'principal'], ['fee_clerk', 'clerk'], ['owner', 'principal']]) assert.strictEqual(data(post(a, role, who, { id: 'T-0002' })).code, 'not_authorized', a + ' ' + role);
assert.strictEqual(calls.length, 0);

// the config: audited first (the look, never values)
const cfg = data(post('gameHrSalaryConfig', 'owner', 'owner', {}));
assert.strictEqual(cfg.payScale[0].designation, 'TGT');
assert.deepStrictEqual(JSON.parse(JSON.stringify(tabs['Game Reveals'].rows.filter((x) => x[0] !== 'At').map((x) => x.slice(1)))), [['Owner Person', 'salary config', '']]);

// record an offer the first time: the hiring row (notes appended, breakdown, date), then the approval request
let r = data(post('gameHrOffer', 'owner', 'owner', { id: 'T-0002', campus: 'LMS1', breakdown: JSON.stringify({ ...B, evil: 'x' }), netY2: '16410', netY3: '17140' }));
assert.deepStrictEqual([r.ok, r.approval], [true, 'submitted']);
const upd = calls.find((c) => c[0] === 'hiringUpdateStatus_')[2];
assert.strictEqual(upd.row, 11);
assert.match(upd.notes, /^Earlier note \| Salary Offer recorded: TGT: English — CTI ₹24,342, Net Bank Y1 ₹15,679\/mo, experience LMS 0 y \+ other 3 y \(\d{4}-\d{2}-\d{2}\)$/);
assert.deepStrictEqual(JSON.parse(upd.offerBreakdown), B, 'known keys only');
assert.ok(upd.salaryOfferAt);
const apr = calls.find((c) => c[0] === 'aprSubmit_')[2];
assert.strictEqual(apr.category, 'Salary Offer Approval');
assert.match(apr.description, /Y2 ₹16,410\/mo, Y3 ₹17,140\/mo/);
assert.strictEqual(apr.itemName, 'T-0002 — Applicant 1');
// a second offer on someone already offered: the row only, no second approval
calls.length = 0;
r = data(post('gameHrOffer', 'owner', 'owner', { id: 'T-0003', campus: 'LMS2', breakdown: JSON.stringify(B) }));
assert.strictEqual(r.approval, 'already');
assert.deepStrictEqual(calls.map((c) => c[0]), ['hiringUpdateStatus_']);
// refusals: a school the applicant didn't apply to; bad figures; nothing written
calls.length = 0;
assert.strictEqual(data(post('gameHrOffer', 'owner', 'owner', { id: 'T-0002', campus: 'LMS2', breakdown: JSON.stringify(B) })).code, 'refused');
assert.strictEqual(data(post('gameHrOffer', 'owner', 'owner', { id: 'T-0002', campus: 'LMS1', breakdown: JSON.stringify({ ...B, cti: 'lots' }) })).code, 'refused');
assert.strictEqual(data(post('gameHrOffer', 'owner', 'owner', { id: 'T-0002', campus: 'LMS1', breakdown: '{nope' })).code, 'refused');
assert.strictEqual(calls.length, 0);
// the log has the step, never a figure
assert.ok(tabs['Game Actions'].rows.some((x) => x[2] === 'offer' && x[3] === 'T-0002'));
assert.ok(!JSON.stringify(tabs['Game Actions'].rows).includes('24342') && !JSON.stringify(tabs['Game Reveals'].rows).includes('24342'));

// EPF exemption: status by the applicant's own name (from the row, never the client), and a request
assert.strictEqual(data(post('gameHrEpf', 'owner', 'owner', { id: 'T-0002' })).approved, true);
assert.strictEqual(data(post('gameHrEpf', 'owner', 'owner', { id: 'T-0001', name: 'Applicant 1' })).approved, false, 'the client’s name is ignored');
calls.length = 0;
assert.strictEqual(data(post('gameHrEpf', 'owner', 'owner', { id: 'T-0001', op: 'request', campus: 'lms1' })).requested, true);
assert.deepStrictEqual(calls[0][2], { category: 'EPF Exemption', title: 'EPF Exemption — Same Name', description: 'MD-level hire at LMS1. Requesting EPF exemption per standard MD compensation structure.', itemName: 'Same Name' });

// ₹ grouping without Intl, as en-IN
for (const [n, t] of [[0, '₹0'], [999, '₹999'], [1000, '₹1,000'], [123456, '₹1,23,456'], [12345678, '₹1,23,45,678']]) assert.strictEqual(h.g.gameHrInr_(n), t);
console.log('test-game-hr-s3: all passed');
