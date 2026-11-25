// node tests/pdr/test-game-hr-notes.js -- G2 FIX (security, 26 Nov): a Principal or Fee Clerk never reads a salary offer in an applicant's
// notes (gameHrDetail_); the Owner still does. Synthetic data only.
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
  appl(0, 'LMS-1 Dhalpur', { name: 'Same Name', notes: 'Walk-in, strong English | Salary Offer recorded: TGT: English — CTI ₹24,342, Net Bank Y1 ₹15,679/mo, experience LMS 0 y + other 3 y (2026-11-25) | Asked about the bus route | Expects Rs. 22000' }),
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
const detail = (role, who, extra) => JSON.parse(JSON.stringify(h.post('gameHrApplicant', Object.assign({ key: KEY, role, email: who + '@lms.org.in', campus: null, campuses: ['LMS1'], params: { id: 'T-0001' } }, extra)))).data;
const OFFER = /salary offer|CTI|Net Bank|₹|Rs\.\s*\d/i;

const own = detail('owner', 'owner');
assert.ok(OFFER.test(own.notes) && own.notes.includes('CTI ₹24,342'), 'the Owner still reads the offer');
for (const [role, who] of [['principal', 'principal'], ['fee_clerk', 'clerk']]) {
  const d = detail(role, who);
  assert.strictEqual(d.ok, true, role);
  assert.ok(!OFFER.test(d.notes), role + ' sees no offer line: ' + d.notes);
  assert.ok(!OFFER.test(JSON.stringify(d)), role + ': no salary anywhere in the detail');
  assert.strictEqual(d.notes, 'Walk-in, strong English | Asked about the bus route', role + ' keeps the other notes');
}
// the fresh detail a step answers with is cut the same way
const step = JSON.parse(JSON.stringify(h.post('gameHrAct', { key: KEY, role: 'principal', email: 'principal@lms.org.in', campus: null, campuses: ['LMS1'], params: { op: 'shortlist', id: 'T-0001' } }))).data;
assert.ok(step.ok !== false && !OFFER.test(step.notes || ''), 'a step’s fresh detail carries no offer for a Principal');
// a notes field that is only the offer comes back empty, not partly
assert.strictEqual(h.g.gameHrNotesFor_('Salary Offer recorded: CTI ₹1', 'Principal'), '');
assert.strictEqual(h.g.gameHrNotesFor_('Salary Offer recorded: CTI ₹1', 'Owner'), 'Salary Offer recorded: CTI ₹1');
console.log('test-game-hr-notes: all passed');
