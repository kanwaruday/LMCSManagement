// node tests/pdr/test-game-hr.js -- W7 (N3): game-hr.gs, the key-gated gameHr* actions behind lms-game's Owner hiring room.
// Runs the REAL main.gs dispatch + game-approvals.gs gate helpers + game-hr.gs; hiring.gs's reads are faked. Fake data only (public repo).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const KEY = 'k'.repeat(40);
const appl = (n, branches, extra) => Object.assign({
  row: n + 1, applicantId: 'T-' + String(n + 1).padStart(4, '0'), name: 'Applicant ' + n, phone: '+91 90000 0000' + n, branches,
  subjects: 'English', qualification: 'MA', status: 'Shortlisted', matchScore: 7, timestamp: '2026-11-01T05:00:00.000Z', round: 1,
  rejectReason: '', positionLabel: 'TGT: English', notes: 'Private note ' + n, salaryOfferAt: '', offerBreakdown: null,
  appointments: [], interviewReports: [], demoReports: [], history: [], docsMissing: [],
}, extra);
const LIST = [
  appl(1, 'LMS-1 Dhalpur', { appointments: [{ kind: 'interview', start: '2099-01-01T05:00:00.000Z', status: 'accepted', reportFiled: false }] }),
  appl(2, 'LMS-2 Kelheli', { status: 'Salary Offer', salaryOfferAt: '2026-11-05T05:00:00.000Z', offerBreakdown: { gross: 25000, basic: 12000 },
    interviewReports: [{ 'Submitted At': '2026-11-03T05:00:00.000Z', recommendation: 'Hire', 'Expected salary': '30000', Phone: '9000000002' }] }),
  appl(3, 'LMS-1 Dhalpur, LMS-3 Dunkhra', { docsMissing: ['Bio-Data'], status: 'Hiring Approved' }),
];
const reveals = [];
const fresh = () => boot({
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
    hiringApprovalStatus_: () => ({ success: true, campuses: [
      { campusId: 'LMS1', newPositions: [{ roleLevel: 'TGT' }], hiringDecisionApproved: true },
      { campusId: 'LMS2', newPositions: [], hiringDecisionApproved: false }] }),
    hirWorkbook_: () => {
      const sh = { getLastRow: () => reveals.length, appendRow: (r) => reveals.push(r) };
      return { getSheetByName: () => sh, insertSheet: () => sh };
    },
  },
});

const h = fresh();
const call = (action, who, extra) => h.post(action, Object.assign({ key: KEY, email: who ? who + '@lms.org.in' : null, campus: null, campuses: ['LMS1', 'LMS2', 'LMS3'], params: {} }, extra));
const data = (r) => { assert.strictEqual(r.success, true, JSON.stringify(r)); return r.data; };
const clean = (r, what) => {
  const s = JSON.stringify(r);
  assert.ok(!/@/.test(s), what + ' leaked an email');
  assert.ok(!/90000\s?0000\d|900000000\d/.test(s), what + ' leaked a full phone');
  assert.ok(!/25000|12000|30000/.test(s), what + ' leaked a salary figure');
  assert.ok(!/Private note/.test(s) || what === 'detail', what + ' leaked notes');
};

// the gate: key, person, Owner only
assert.deepStrictEqual(call('gameHrPipeline', 'owner', { key: 'wrong' }), { success: false, error: 'not_authorized' });
assert.deepStrictEqual(call('gameHrNope', 'owner'), { success: false, error: 'unknown_action' });
assert.deepStrictEqual(data(call('gameHrPipeline', null)), { ok: false, code: 'not_authorized' });
for (const who of ['coord', 'principal', 'clerk', 'stranger']) assert.strictEqual(data(call('gameHrPipeline', who)).code, 'not_authorized', who);
for (const who of ['coord', 'principal']) assert.strictEqual(data(call('gameHrReveal', who, { params: { id: 'T-0003', field: 'offer' } })).code, 'not_authorized', who);
// lane-e's and lane-h's dispatch lines don't catch gameHr*, and gameHr doesn't catch theirs
{ // the three game dispatch lines in main.gs, read from the source: each catches its own actions only
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../apps-script/main.gs'), 'utf8');
  const hr = /^gameHr[A-Z]/, apr = /^gameApproval/, pdr = /^game(pdr|ss)[a-z]/;
  for (const re of [hr, apr, pdr]) assert.ok(src.includes(re.toString()), 'main.gs no longer has ' + re);
  for (const a of ['gameHrPipeline', 'gameHrApplicant', 'gameHrReveal']) assert.ok(hr.test(a) && !apr.test(a) && !pdr.test(a.toLowerCase()), a);
  for (const a of ['gameApprovalsList', 'gameApprovalDecide', 'gamePdrHome', 'gameSsList']) assert.ok(!hr.test(a), a);
}

// pipeline: masked, no salary, cut to the proxy's schools
let r = call('gameHrPipeline', 'owner');
clean(r, 'pipeline');
let d = data(r);
assert.strictEqual(d.applicants.length, 3);
assert.deepStrictEqual(d.schools, [{ code: 'LMS1', openPositions: 1, hiringApproved: true }, { code: 'LMS2', openPositions: 0, hiringApproved: false }]);
const a1 = d.applicants.find((a) => a.id === 'T-0002');
assert.strictEqual(a1.phone, '··0001');
assert.deepStrictEqual(a1.next, { kind: 'interview', start: '2099-01-01T05:00:00.000Z', status: 'accepted' });
assert.strictEqual(d.applicants.find((a) => a.id === 'T-0003').hasOffer, true);
assert.strictEqual(d.applicants.find((a) => a.id === 'T-0004').docsMissing, 1);
assert.deepStrictEqual(d.applicants.find((a) => a.id === 'T-0004').schools, ['LMS1', 'LMS3']);
// only LMS1 in the proxy's set: LMS2's applicant is gone, the two-school one shows LMS1 only
d = data(call('gameHrPipeline', 'owner', { campuses: ['LMS1'] }));
assert.deepStrictEqual(d.applicants.map((a) => a.id).sort(), ['T-0002', 'T-0004']);
assert.deepStrictEqual(d.applicants.find((a) => a.id === 'T-0004').schools, ['LMS1']);
// no school list = nothing (fails closed)
for (const campuses of [null, undefined, []]) assert.strictEqual(data(call('gameHrPipeline', 'owner', { campuses })).applicants.length, 0);

// detail: notes for the Owner, report recommendation only (no expected salary, no phone)
r = call('gameHrApplicant', 'owner', { params: { id: 'T-0003' } });
clean(r, 'detail');
d = data(r);
assert.strictEqual(d.notes, 'Private note 2');
assert.deepStrictEqual(d.reports, [{ kind: 'interview', at: '2026-11-03T05:00:00.000Z', recommendation: 'Hire' }]);
assert.strictEqual(data(call('gameHrApplicant', 'owner', { params: { id: 'T-0003' }, campuses: ['LMS1'] })).code, 'not_found'); // another school's
assert.strictEqual(data(call('gameHrApplicant', 'owner', { params: { id: 'T-9999' } })).code, 'not_found');

// reveal: audited before the value goes out; the audit row never holds the value
assert.strictEqual(reveals.length, 0);
d = data(call('gameHrReveal', 'owner', { params: { id: 'T-0003', field: 'offer' } }));
assert.deepStrictEqual(d.value, { gross: 25000, basic: 12000 });
d = data(call('gameHrReveal', 'owner', { params: { id: 'T-0002', field: 'phone' } }));
assert.strictEqual(d.value, '+91 90000 00001');
const audit = reveals.filter((x) => x[0] !== 'At');
assert.strictEqual(audit.length, 2);
assert.deepStrictEqual(JSON.parse(JSON.stringify(audit.map((x) => x.slice(1)))), [['Owner Person', 'offer', 'T-0003'], ['Owner Person', 'phone', 'T-0002']]);
assert.ok(!/25000|90000/.test(JSON.stringify(reveals)), 'the audit holds a value');
assert.strictEqual(data(call('gameHrReveal', 'owner', { params: { id: 'T-0002', field: 'offer' } })).code, 'nothing');
assert.strictEqual(data(call('gameHrReveal', 'owner', { params: { id: 'T-0002', field: 'aadhaar' } })).code, 'bad_input');
assert.strictEqual(data(call('gameHrReveal', 'owner', { params: { id: 'T-0003', field: 'offer' }, campuses: ['LMS1'] })).code, 'not_found');
assert.strictEqual(reveals.filter((x) => x[0] !== 'At').length, 2, 'a refused reveal was audited');

console.log('test-game-hr: all passed');
