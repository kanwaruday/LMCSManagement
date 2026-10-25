// node tests/coordinator/test-decision.js -- decision preview for approvals: history, staff, events, plain cards, route scope + cache
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const DAY = 86400000, now = new Date('2026-10-25T12:00:00.000Z');
const ago = (d) => new Date(now.getTime() - d * DAY).toISOString();
const apr = (id, campus, cat, status, decidedDaysAgo, title) => { const r = new Array(19).fill(''); r[0] = id; r[1] = campus; r[2] = cat; r[4] = title || 'Title ' + id; r[6] = 1200; r[11] = 'r@lms.org.in';
  r[12] = ago(3.5); r[13] = status; if (decidedDaysAgo != null) { r[14] = 'o@lms.org.in'; r[15] = ago(decidedDaysAgo); } return r; };
const fin = 'Financial / Purchase';
const aprRows = [['id'], apr('f-1', 'LMS4', fin, 'Pending'), apr('f-2', 'LMS4', fin, 'Approved', 10), apr('f-3', 'LMS4', fin, 'Approved', 200), apr('f-4', 'LMS4', fin, 'Rejected', 300),
  apr('f-old', 'LMS4', fin, 'Approved', 400), apr('f-other', 'LMS5', fin, 'Approved', 5), apr('f-cat', 'LMS4', 'Other', 'Approved', 5),
  apr('s-1', 'LMS4', 'New/ Backup Position', 'Pending'), apr('d-1', 'LMS4', 'Disciplinary / Termination', 'Pending'), apr('a-1', 'LMS4', 'Salary Offer Approval', 'Pending'),
  apr('e-1', 'LMS4', 'Event / Invitation', 'Pending'), apr('e-2', 'LMS4', 'Holiday / Calendar', 'Approved', 5, 'Diwali break'), apr('e-3', 'LMS4', 'Off-Campus Trip / Excursion', 'Approved', 40, 'Old trip'),
  apr('e-4', 'LMS5', 'Event / Invitation', 'Approved', 5, 'Other campus'), apr('e-5', 'LMS4', 'Event / Invitation', 'Rejected', 5, 'Rejected event'), apr('e-6', 'LMS4', 'Other', 'Approved', 2, 'Not an event')];
const empRows = [['EmployeeCode', 'SchoolCode', 'Status'], ['E1', 'LMS4', 'Active'], ['E2', 'LMS4', 'Active'], ['E3', 'LMS4', 'Active'], ['E4', 'LMS4', 'Inactive'], ['E5', 'LMS5', 'Active']];
const taskRows = [['TaskId'], ['hiring_stall|a', 'hiring_stall', 'LMS4', '', '', 'open'], ['hiring_stall|b', 'hiring_stall', 'LMS4', '', '', 'resolved'],
  ['hiring_stall|c', 'hiring_stall', 'LMS5', '', '', 'open'], ['ss|d', 'ss_compliance', 'LMS4', '', '', 'open']];
const recRows = [['RecId'], ['rec-1', 'd-1', 'LMS4', 'Disciplinary / Termination', 'c@lms.org.in', 'Reject', 'why', 'looked', '2026-10-25T10:00:00.000Z', ''],
  ['rec-2', 'f-1', 'LMS4', fin, 'c@lms.org.in', 'Approve', 'old', '', '2026-10-25T09:00:00.000Z', 'TRUE']];

// fake workbooks for the route
const tabs = { Approvals: aprRows, Tasks: taskRows, EmpMaster: empRows, Recommendations: recRows };
let opens = 0; const store = {}, puts = [];
const sheetOf = (n) => ({ getLastRow: () => tabs[n].length, getDataRange: () => ({ getValues: () => tabs[n].map((r) => r.slice()) }) });
const ctx = { console, ContentService: {}, LockService: {},
  CacheService: { getScriptCache: () => ({ get: (k) => store[k] || null, put: (k, v, s) => { store[k] = v; puts.push([k, s]); } }) },
  SpreadsheetApp: { openById: () => { opens++; return { getSheets: () => [{ getDataRange: () => ({ getValues: () => [['email', 'name', 'campus', 'roles'], ['c@lms.org.in', 'Test Coord', 'ALL', 'Coordinator']] }) }], getSheetByName: (n) => tabs[n] ? sheetOf(n) : null }; } } };
vm.createContext(ctx);
['coordinator', 'coordinator-approvals', 'coordinator-pdr', 'coordinator-recommend'].forEach((f) =>
  vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f + '.gs', 'utf8'), ctx));
const plain = (x) => JSON.parse(JSON.stringify(x));
const pv = (id) => plain(ctx.coordDecisionPreview_(id, aprRows, recRows, empRows, taskRows, now));

// Financial: 2 approved + 1 rejected in the last year; the 400-day-old one, other campus/category and this id are not counted
let d = pv('f-1');
assert.deepStrictEqual(d, { id: 'f-1', campus: 'LMS4', category: fin, title: 'Title f-1', amount: 1200, waitingDays: 3, requestedBy: 'r@lms.org.in',
  preview: { history: { approved: 2, rejected: 1 } }, recommendation: null });             // the superseded recommendation is not shown

// New/ Backup Position: 3 active (one inactive, one at another campus ignored) and 1 open hiring_stall at LMS4
d = pv('s-1');
assert.deepStrictEqual(d.preview.staff, { active: 3, openStalls: 1 });
assert.deepStrictEqual(d.preview.history, { approved: 0, rejected: 0 });
assert.strictEqual(d.preview.events, undefined);

// Disciplinary / Termination: a plain card, but the recommendation still shows
d = pv('d-1');
assert.strictEqual(d.preview, null);
assert.strictEqual(d.recommendation.recommendation, 'Reject');
assert.strictEqual(d.recommendation.by, 'c@lms.org.in');
['Compensation Change', 'EPF Exemption', 'Salary Offer Approval'].forEach((c) => {
  const rows = [['id'], apr('x', 'LMS4', c, 'Pending')];
  assert.strictEqual(ctx.coordDecisionPreview_('x', rows, [], [], [], now).preview, null, c);
});
assert.strictEqual(ctx.coordDecisionPreview_('a-1', aprRows, recRows, empRows, taskRows, now).preview, null);

// Events: the campus's approved requests in the 3 event categories, last 30 days only (not rejected, not older, not other campuses/categories)
d = pv('e-1');
assert.deepStrictEqual(d.preview.events, [{ title: 'Diwali break', decidedAt: ago(5) }]);
assert.strictEqual(d.preview.staff, undefined);

// unknown id; a Date from the sheet reads like its ISO string
assert.strictEqual(ctx.coordDecisionPreview_('nope', aprRows, recRows, empRows, taskRows, now), null);
const dated = aprRows[2].slice(); dated[12] = new Date(ago(2)); dated[15] = new Date(ago(10));
assert.strictEqual(ctx.coordDecisionPreview_('f-2', [['id'], dated], [], [], [], now).waitingDays, 2);

// route: Not authorized outside the caller's campuses; found: byName from the allowlist; cached 120 s per id, sheets opened only on a miss
const coord = { email: 'c@lms.org.in', campusId: 'ALL', roles: ['Coordinator'] };
assert.strictEqual(opens, 0);
const r = plain(ctx.coordDecision_(coord, 'd-1'));
assert.strictEqual(r.success, true);
assert.strictEqual(r.decision.preview, null);
assert.strictEqual(r.decision.recommendation.byName, 'Test Coord');
assert.deepStrictEqual(puts, [['coord_decision_d-1', 120]]);
const before = opens;
assert.strictEqual(plain(ctx.coordDecision_(coord, 'd-1')).decision.title, 'Title d-1');
assert.strictEqual(puts.length, 1);                                                      // second call served from the cache
assert.strictEqual(opens, before + 2);                                                   // ...only the recommendation (Recommendations tab + names) is read fresh
assert.strictEqual(ctx.coordDecision_({ email: 'c@lms.org.in', campusId: 'LMS1', roles: ['Coordinator'] }, 'd-1').error, 'Not authorized'); // LMS4 is outside LMS 1-3 (also from the cache)
assert.strictEqual(ctx.coordDecision_({ email: 'c@lms.org.in', campusId: 'LMS2', roles: ['Coordinator'] }, 'f-1').error, 'Not authorized');
assert.strictEqual(ctx.coordDecision_(coord, 'nope').error, 'Request not found');
assert.strictEqual(puts.length, 2);                                                      // d-1 and f-1 cached; an unknown id is not
console.log('coordinator decision: ok');
