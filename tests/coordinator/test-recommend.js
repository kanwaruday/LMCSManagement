// node tests/coordinator/test-recommend.js -- recommendations on approvals: validation, latest, write path, private track record
const fs = require('fs'), vm = require('vm'), assert = require('assert');

// fake workbook: Approvals (read-only here) + Recommendations (created on first use)
const tabs = { Approvals: [['id', 'campusId', 'category', 'urgency', 'title', '', '', '', '', '', '', '', '', 'status', 'by', 'at', 'note', '', 'archived']] };
const aprRow = (id, campus, cat, status, archived) => { const r = new Array(19).fill(''); r[0] = id; r[1] = campus; r[2] = cat; r[4] = 'Title ' + id; r[13] = status; r[18] = archived || ''; return r; };
tabs.Approvals.push(aprRow('apr-1', 'LMS1', 'Financial / Purchase', 'Pending'), aprRow('apr-5', 'LMS5', 'Financial / Purchase', 'Pending'));
const sheetOf = (name) => ({
  getLastRow: () => tabs[name].length,
  getDataRange: () => ({ getValues: () => tabs[name].map((r) => r.slice()) }),
  getRange: (r, c, nr, nc) => { const rng = {
    setValues: (v) => v.forEach((row, i) => { tabs[name][r - 1 + i] = tabs[name][r - 1 + i] || []; row.forEach((x, j) => { tabs[name][r - 1 + i][c - 1 + j] = x; }); }) || rng,
    setValue(x) { return rng.setValues([[x]]); },
    setNumberFormat() { return rng; }, setFontWeight() { return rng; } }; return rng; },
  setFrozenRows() {} });
const ctx = { console, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: {}, SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: () => [['email', 'name', 'campus', 'roles'], ['c@lms.org.in', 'Test Coord', 'ALL', 'Coordinator']] }) }], getSheetByName: (n) => tabs[n] ? sheetOf(n) : null, insertSheet: (n) => { tabs[n] = []; return sheetOf(n); } }) } };
vm.createContext(ctx);
['coordinator', 'coordinator-approvals', 'coordinator-pdr', 'coordinator-recommend'].forEach((f) =>
  vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f + '.gs', 'utf8'), ctx));

// validation: each message, then a valid input
const ok = { recommendation: 'Approve', reason: 'Quote is fair' }, pending = aprRow('x', 'LMS1', 'Other', 'Pending');
const v = (b, r) => ctx.coordRecValidate_(Object.assign({}, ok, b), r || pending);
assert.strictEqual(v({ recommendation: 'Maybe' }), 'Pick Approve, Reject or Ask for information.');
assert.strictEqual(v({ reason: '   ' }), 'Write the reason for your recommendation.');
assert.strictEqual(v({ reason: 'x'.repeat(501) }), 'Keep the reason under 500 characters.');
assert.strictEqual(v({}, aprRow('x', 'LMS1', 'Other', 'Approved')), 'This request was already decided.');
assert.strictEqual(v({}, aprRow('x', 'LMS1', 'Other', 'Pending', 'TRUE')), 'This request is archived.');
assert.strictEqual(v({ reason: 'x'.repeat(500), recommendation: 'Info' }, aprRow('x', 'LMS1', 'Other', 'Info Requested')), null);
assert.strictEqual(v({}), null);

// latest: superseded rows are ignored; of the rest the later RecommendedAt wins
const rec = (id, apr, by, what, at, sup, cat) => [id, apr, 'LMS1', cat || 'Financial / Purchase', by, what, 'why ' + id, '[]', at, sup || ''];
const recs = [rec('rec-1', 'apr-1', 'c@lms.org.in', 'Approve', '2026-10-25T10:00:00.000Z'), rec('rec-2', 'apr-1', 'c@lms.org.in', 'Reject', '2026-10-25T10:05:00.000Z'),
  rec('rec-3', 'apr-1', 'c@lms.org.in', 'Info', '2026-10-25T11:00:00.000Z', 'TRUE')];
const latest = ctx.coordRecLatest_(recs);
assert.strictEqual(latest['apr-1'].recommendation, 'Reject');
assert.deepStrictEqual(Object.keys(latest), ['apr-1']);

// two writes on one request leave exactly one live row, the second; an Owner cannot recommend
const coord = { email: 'c@lms.org.in', campusId: 'ALL', roles: ['Coordinator'] };
assert.strictEqual(ctx.coordRecommend_(coord, { approvalId: 'apr-1', recommendation: 'Approve', reason: 'first', checked: ['a'] }).success, true);
const second = ctx.coordRecommend_(coord, { approvalId: 'apr-1', recommendation: 'Reject', reason: 'second' });
assert.strictEqual(second.success, true);
assert.strictEqual(second.recommendation.recommendation, 'Reject');
const live = tabs.Recommendations.slice(1).filter((r) => r[9] !== 'TRUE');
assert.strictEqual(live.length, 1);
assert.strictEqual(live[0][6], 'second');
assert.strictEqual(tabs.Recommendations.length, 3);
assert.strictEqual(tabs.Recommendations[0].join(','), 'RecId,ApprovalId,Campus,Category,RecommendedBy,Recommendation,Reason,Checked,RecommendedAt,Superseded');
assert.strictEqual(JSON.stringify(ctx.coordRecommend_({ email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'] }, { approvalId: 'apr-1', recommendation: 'Approve', reason: 'x' })),
  JSON.stringify({ success: false, error: 'The Owner decides directly.' }));
assert.strictEqual(second.recommendation.byName, 'Test Coord');
assert.strictEqual(ctx.coordRecommend_(coord, { approvalId: 'nope', recommendation: 'Approve', reason: 'x' }).success, false);
assert.strictEqual(ctx.coordRecommend_({ email: 'c@lms.org.in', campusId: 'LMS2', roles: ['Coordinator'] }, { approvalId: 'apr-5', recommendation: 'Approve', reason: 'x' }).error, 'Not authorized'); // outside LMS 1-3

// approval tasks gain the latest recommendation (with byName); other tasks and unrecommended approvals are untouched / null
const tasks = [{ taskId: 'approval|apr-1|Pending' }, { taskId: 'approval|apr-5|Pending' }, { taskId: 'ss|x' }];
ctx.coordRecAttach_(tasks);
assert.strictEqual(tasks[0].recommendation.recommendation, 'Reject');
assert.strictEqual(tasks[0].recommendation.byName, 'Test Coord');
assert.strictEqual(tasks[1].recommendation, null);
assert.strictEqual('recommendation' in tasks[2], false);

// byName: name from the allowlist, else the email
assert.strictEqual(ctx.coordRecNamed_({ by: 'c@lms.org.in' }, [{ email: 'c@lms.org.in', name: 'Test Coord' }]).byName, 'Test Coord');
assert.strictEqual(ctx.coordRecNamed_({ by: 'z@lms.org.in' }, [{ email: 'c@lms.org.in', name: 'Test Coord' }]).byName, 'z@lms.org.in');

// track record: 3 decided (2 matched) + 1 pending; one key per recommender
const cat = 'Financial / Purchase', me = 'c@lms.org.in';
const apr = [['id'], aprRow('apr-1', 'LMS1', cat, 'Approved'), aprRow('apr-2', 'LMS1', cat, 'Approved'), aprRow('apr-3', 'LMS1', cat, 'Info Requested'), aprRow('apr-4', 'LMS1', cat, 'Pending'), aprRow('apr-6', 'LMS1', cat, 'Rejected')];
apr.slice(1, 4).forEach((r) => { r[14] = 'o@lms.org.in'; r[15] = '2026-10-26'; r[16] = 'note ' + r[0]; });
const rows = [['RecId'], rec('r1', 'apr-1', me, 'Approve', '2026-10-25T10:00:00.000Z'), rec('r2', 'apr-2', me, 'Reject', '2026-10-25T10:01:00.000Z'),
  rec('r3', 'apr-3', me, 'Info', '2026-10-25T10:02:00.000Z'), rec('r4', 'apr-4', me, 'Approve', '2026-10-25T10:03:00.000Z'),
  rec('r5', 'apr-1', me, 'Reject', '2026-10-25T09:00:00.000Z', 'TRUE'),            // superseded: not counted
  rec('r6', 'apr-6', 'd@lms.org.in', 'Reject', '2026-10-25T10:04:00.000Z')];       // Rejected, but no decidedByEmail: not decided
const tr = ctx.coordTrackRecord_(rows, apr, null);
assert.deepStrictEqual(JSON.parse(JSON.stringify(tr[me].byCategory[cat])), { made: 4, decided: 3, matched: 2 });
assert.deepStrictEqual(JSON.parse(JSON.stringify(tr['d@lms.org.in'].byCategory[cat])), { made: 1, decided: 0, matched: 0 });
assert.strictEqual(tr[me].recent.length, 4);
assert.strictEqual(tr[me].recent[0].approvalId, 'apr-4');                           // newest first
assert.strictEqual(tr[me].recent.find((e) => e.approvalId === 'apr-2').matched, false);
assert.strictEqual(tr[me].recent.find((e) => e.approvalId === 'apr-2').decisionNote, 'note apr-2');
assert.deepStrictEqual(Object.keys(ctx.coordTrackRecord_(rows, apr, me)), [me]);
// Reject also matches Revoked
const rv = aprRow('apr-7', 'LMS1', cat, 'Revoked'); rv[14] = 'o@lms.org.in';
assert.strictEqual(ctx.coordTrackRecord_([rec('r7', 'apr-7', me, 'Reject', '2026-10-25T10:00:00.000Z')], [rv], me)[me].byCategory[cat].matched, 1);
console.log('coordinator recommend: ok');
