// node tests/pdr/test-game-approvals.js -- W4 (lane-h): game-approvals.gs, the key-gated gameApproval* actions behind lms-game's classic
// proxy. Runs the REAL main.gs + approvals.gs + approvals-leave.gs + game-approvals.gs over fake sheets. Fake data only (public repo).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const APR = '1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4', EMP = 'emp-book';
const KEY = 'k'.repeat(40), SECRET = 's'.repeat(40);
const head = ['Id', 'Campus', 'Category', 'Urgency', 'Title', 'Description', 'Amount', 'Item', 'Qty', 'Linked', 'Evidence', 'RequestedBy', 'RequestedAt',
  'Status', 'DecidedBy', 'DecidedAt', 'DecisionNote', 'referredTo', 'archived'];
const row = (id, campus, category, status, by) => [id, campus, category, 'Normal', 'Title ' + id, 'Desc', '', '', '', '', '', by, new Date('2026-11-01T05:00:00Z'), status, '', '', '', '', ''];
const mail = [];
// the shared fake sheet has no appendRow (approvals.gs's comment writer uses it): add one per tab of the Approvals book
const withAppend = (h) => { Object.values(h.books[APR].tabs).forEach((t) => { t.appendRow = (r) => { t.values.push(r); }; }); return h; };
const fresh = () => withAppend(boot({
  allowlistRows: [['Email', 'Name', 'CampusId', 'Role', 'CanApprove'],
    ['owner@lms.org.in', 'Owner Person', 'ALL', 'Owner', ''],
    ['coord@lms.org.in', 'Coord Decider', 'ALL', 'Coordinator', 'TRUE'],
    ['coord2@lms.org.in', 'Coord Plain', 'LMS1', 'Coordinator', ''],
    ['principal@lms.org.in', 'Principal One', 'LMS1', 'Principal', ''],
    ['teacher@lms.org.in', 'Teacher One', 'LMS1', 'Teacher', '']],
  books: {
    [APR]: {
      Approvals: [head, row('a1', 'LMS1', 'Financial / Purchase', 'Pending', 'principal@lms.org.in'), row('a2', 'LMS2', 'Other', 'Pending', 'p2@lms.org.in'),
        row('a3', 'LMS1', 'Other', 'Approved', 'principal@lms.org.in'), Object.assign(row('a4', 'LMS1', 'Salary Offer Approval', 'Pending', 'principal@lms.org.in'), { 7: 'Offer T-0007' })],
      Comments: [['Id', 'ApprovalId', 'AuthorEmail', 'AuthorRole', 'Body', 'PostedAt'],
        ['c1', 'a1', 'owner@lms.org.in', 'Owner', 'Why now?', new Date('2026-11-02T05:00:00Z')],
        ['c2', 'a1', 'coord@lms.org.in', 'Coordinator', 'Checked the quote', new Date('2026-11-02T06:00:00Z')]],
      Recommendations: [['RecId', 'ApprovalId', 'Campus', 'Category', 'RecommendedBy', 'Recommendation', 'Reason', 'Checked', 'RecommendedAt', 'Superseded'],
        ['rec-1', 'a1', 'LMS1', 'Financial / Purchase', 'coord@lms.org.in', 'Approve', 'Fair price', '', '2026-11-03T05:00:00.000Z', '']],
    },
    [EMP]: {
      EmpMaster: [['EmployeeCode', 'Name', 'Status'], ['KUL/1', 'Staff Alpha', 'Active'], ['KUL/2', 'Staff Beta', 'Active'], ['KUL/3', 'Gone Person', 'Inactive']],
      EmpPersonal: [['EmployeeCode', 'AuthEmail'], ['KUL/1', 'alpha@lms.org.in'], ['KUL/2', 'beta@lms.org.in'], ['KUL/3', 'gone@lms.org.in']],
    },
  },
  files: ['supporting-charge', 'approvals-leave', 'approvals', 'game-approvals'],
  extra: {
    TP_EMP_SHEET_ID: EMP,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ GAME_KEY: KEY, GAME_PEOPLE_SECRET: SECRET })[k] || null }) },
    MailApp: { sendEmail: (to, subject) => mail.push({ to, subject }) },
    hirSheet_: () => ({ getLastRow: () => 1, getRange: () => ({ getValues: () => [] }) }), HIR_COL: { MD_INTERVIEW_AT: 1 },
    hirSalaryOfferGateCheck_: () => ({ ok: false, error: 'Waiting for the MD Academics interview' }), hirQueuePositionSync_: () => {},
  },
}));

let h = fresh();
const call = (action, who, extra) => h.post(action, Object.assign({ key: KEY, email: who ? who + '@lms.org.in' : null, campus: null, campuses: null, params: {} }, extra));
const data = (r) => { assert.strictEqual(r.success, true, JSON.stringify(r)); return r.data; };
const noEmails = (r, what) => assert.ok(!/@/.test(JSON.stringify(r)), what + ' leaked an email: ' + JSON.stringify(r));

// the gate: key, person, and the room is Management's
assert.deepStrictEqual(call('gameApprovalsList', 'owner', { key: 'wrong' }), { success: false, error: 'not_authorized' });
assert.deepStrictEqual(data(call('gameApprovalsList', null)), { ok: false, code: 'not_authorized' });
for (const who of ['teacher', 'principal', 'stranger']) assert.strictEqual(data(call('gameApprovalsList', who, { campuses: ['LMS1'] })).code, 'not_authorized', who);
assert.deepStrictEqual(call('gameApprovalNope', 'owner'), { success: false, error: 'unknown_action' });

// list: only the proxy's schools, names not emails, recommendation with `mine`
let r = call('gameApprovalsList', 'owner', { campuses: ['LMS1'] });
noEmails(r, 'list');
let d = data(r);
assert.deepStrictEqual(d.requests.map((x) => x.id).sort(), ['a1', 'a3', 'a4']);
const a1 = d.requests.find((x) => x.id === 'a1');
assert.strictEqual(a1.requestedByName, 'Principal One');
assert.deepStrictEqual(a1.recommendation && [a1.recommendation.byName, a1.recommendation.mine], ['Coord Decider', false]);
assert.strictEqual(d.requests.find((x) => x.id === 'a4').awaitingMd, true);
assert.strictEqual(d.canDecide, true);
assert.strictEqual(data(call('gameApprovalsList', 'coord', { campuses: ['LMS1', 'LMS2'] })).requests.find((x) => x.id === 'a1').recommendation.mine, true);
assert.deepStrictEqual(data(call('gameApprovalsList', 'owner', { campuses: [] })).requests, []);              // empty set: nothing
assert.deepStrictEqual(data(call('gameApprovalsList', 'owner', {})).requests, []);                           // no set at all: fail closed
assert.deepStrictEqual(data(call('gameApprovalsList', 'coord2', { campuses: ['LMS1', 'LMS2'] })).requests.map((x) => x.id).sort(), ['a1', 'a3', 'a4']); // its Allowlist view (LMS1) still applies

// detail: the row must be at the proxy's school; comments by name with `mine`; canRecommend for a coordinator only
assert.strictEqual(data(call('gameApprovalDetail', 'owner', { campus: 'LMS2', params: { id: 'a1' } })).code, 'not_authorized');
assert.strictEqual(data(call('gameApprovalDetail', 'owner', { campus: 'LMS1', params: { id: 'zz' } })).code, 'not_found');
r = call('gameApprovalDetail', 'owner', { campus: 'LMS1', params: { id: 'a1' } });
noEmails(r, 'detail');
d = data(r);
assert.deepStrictEqual(d.comments.map((c) => [c.id, c.authorName, c.mine]), [['c1', 'Owner Person', true], ['c2', 'Coord Decider', false]]);
assert.deepStrictEqual([d.canDecide, d.canRecommend], [true, false]);
assert.strictEqual(data(call('gameApprovalDetail', 'coord', { campus: 'LMS1', params: { id: 'a1' } })).canRecommend, true);

// comment: the decider's comment on a Pending request nudges it to Info Requested (rule unchanged); length and school checked
assert.strictEqual(data(call('gameApprovalComment', 'owner', { campus: 'LMS1', params: { id: 'a1', body: 'x'.repeat(501) } })).code, 'bad_input');
assert.strictEqual(data(call('gameApprovalComment', 'owner', { campus: 'LMS2', params: { id: 'a1', body: 'hi' } })).code, 'not_authorized');
assert.deepStrictEqual(data(call('gameApprovalComment', 'owner', { campus: 'LMS1', params: { id: 'a1', body: 'Send the second quote' } })), { ok: true, status: 'Info Requested' });

// comment delete: own only, and the comment must belong to the named request
assert.strictEqual(data(call('gameApprovalCommentDelete', 'coord', { campus: 'LMS1', params: { id: 'a1', commentId: 'c1' } })).code, 'not_authorized');
assert.strictEqual(data(call('gameApprovalCommentDelete', 'owner', { campus: 'LMS1', params: { id: 'a3', commentId: 'c1' } })).code, 'not_found');
assert.deepStrictEqual(data(call('gameApprovalCommentDelete', 'owner', { campus: 'LMS1', params: { id: 'a1', commentId: 'c1' } })), { ok: true });

// referees: deciders only, {key, name}, active staff only
assert.strictEqual(data(call('gameApprovalReferees', 'coord2', { campuses: ['LMS1'] })).code, 'not_authorized');
r = call('gameApprovalReferees', 'owner', { campuses: ['LMS1'] });
noEmails(r, 'referees');
const staff = data(r).staff;
assert.deepStrictEqual(staff.map((s) => s.name), ['Staff Alpha', 'Staff Beta']);
assert.ok(staff.every((s) => /^[A-Za-z0-9_-]{22}$/.test(s.key)));

// decide: rights, school, note, keys -> emails for the referral mail, and the MD gate as a code
h = fresh(); mail.length = 0;
assert.strictEqual(data(call('gameApprovalDecide', 'coord2', { campus: 'LMS1', params: { id: 'a1', decision: 'Approved', note: 'ok' } })).code, 'not_authorized');
assert.strictEqual(data(call('gameApprovalDecide', 'owner', { campus: 'LMS1', params: { id: 'a2', decision: 'Approved', note: 'ok' } })).code, 'not_authorized');
assert.strictEqual(data(call('gameApprovalDecide', 'owner', { campus: 'LMS1', params: { id: 'a1', decision: 'Approved', note: '' } })).code, 'bad_input');
assert.strictEqual(data(call('gameApprovalDecide', 'owner', { campus: 'LMS1', params: { id: 'a1', decision: 'Approved', note: 'ok', referAction: '["not-a-real-key-123"]' } })).code, 'bad_input');
assert.strictEqual(data(call('gameApprovalDecide', 'owner', { campus: 'LMS1', params: { id: 'a1', decision: 'Approved', note: 'ok', referAction: '{"x":1}' } })).code, 'bad_input');
assert.strictEqual(data(call('gameApprovalDecide', 'owner', { campus: 'LMS1', params: { id: 'a4', decision: 'Approved', note: 'ok' } })).code, 'awaiting_md');
r = call('gameApprovalDecide', 'owner', { campus: 'LMS1', params: { id: 'a1', decision: 'Approved', note: 'Go ahead', referAction: JSON.stringify([staff[0].key]), referInformation: JSON.stringify([staff[1].key]) } });
assert.deepStrictEqual(data(r), { ok: true, referred: 2, mailed: true });
assert.ok(mail.some((m) => m.to === 'alpha@lms.org.in') && mail.some((m) => m.to === 'beta@lms.org.in'), 'referral mail goes to the mapped emails');
const sheet = h.books[APR].tabs.Approvals;
assert.strictEqual(sheet.getDataRange().getValues()[1][13], 'Approved');
assert.strictEqual(sheet.getDataRange().getValues()[1][14], 'owner@lms.org.in'); // decidedBy stays the real email in the sheet (unchanged)

// archive: one id, '1'/'0', decided only (rule unchanged), school checked
assert.strictEqual(data(call('gameApprovalArchive', 'owner', { campus: 'LMS1', params: { id: 'a3', archive: 'yes' } })).code, 'bad_input');
assert.strictEqual(data(call('gameApprovalArchive', 'owner', { campus: 'LMS1', params: { id: 'a2', archive: '1' } })).code, 'not_authorized');
assert.deepStrictEqual(data(call('gameApprovalArchive', 'owner', { campus: 'LMS1', params: { id: 'a3', archive: '1' } })), { ok: true, count: 1 });
assert.deepStrictEqual(data(call('gameApprovalArchive', 'owner', { campus: 'LMS1', params: { id: 'a4', archive: '1' } })), { ok: true, count: 0 }); // pending: not archived
assert.strictEqual(data(call('gameApprovalArchive', 'coord2', { campus: 'LMS1', params: { id: 'a3', archive: '0' } })).code, 'not_authorized');

// the portal path is unchanged: no key, no game action
assert.strictEqual(h.post('approvalslist', { idToken: 'none' }).success, false);
console.log('game approvals (PDR): ok');
