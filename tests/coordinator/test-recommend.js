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
    setValue(x) { return rng.setValues([[x]]); }, getValue: () => (tabs[name][r - 1] || [])[c - 1],
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
['toString', 'constructor', '__proto__', 'hasOwnProperty', ['Approve'], undefined, 'approve'].forEach((x) =>
  assert.strictEqual(v({ recommendation: x }), 'Pick Approve, Reject or Ask for information.', String(x)));
assert.strictEqual(v({ reason: '   ' }), 'Write the reason for your recommendation.');
assert.strictEqual(v({ reason: 'x'.repeat(501) }), 'Keep the reason under 500 characters.');
assert.strictEqual(v({}, aprRow('x', 'LMS1', 'Other', 'Approved')), 'This request was already decided.');
assert.strictEqual(v({}, aprRow('x', 'LMS1', 'Other', 'Pending', 'TRUE')), 'This request is archived.');
assert.strictEqual(v({ reason: 'x'.repeat(500), recommendation: 'Info' }, aprRow('x', 'LMS1', 'Other', 'Info Requested')), null);
assert.strictEqual(v({}), null);

// latest: superseded rows are ignored; of the rest the later RecommendedAt wins
const rec = (id, apr, by, what, at, sup, cat) => [id, apr, 'LMS1', cat || 'Financial / Purchase', by, what, 'why ' + id, 'looked at ' + id, at, sup || ''];
const recs = [rec('rec-1', 'apr-1', 'c@lms.org.in', 'Approve', '2026-10-25T10:00:00.000Z'), rec('rec-2', 'apr-1', 'c@lms.org.in', 'Reject', '2026-10-25T10:05:00.000Z'),
  rec('rec-3', 'apr-1', 'c@lms.org.in', 'Info', '2026-10-25T11:00:00.000Z', 'TRUE')];
const latest = ctx.coordRecLatest_(recs);
assert.strictEqual(latest['apr-1'].recommendation, 'Reject');
assert.deepStrictEqual(Object.keys(latest), ['apr-1']);
assert.strictEqual(latest['apr-1'].checked, 'looked at rec-2');

// two writes on one request leave exactly one live row, the second; an Owner cannot recommend
const coord = { email: 'c@lms.org.in', campusId: 'ALL', roles: ['Coordinator'] };
assert.strictEqual(ctx.coordRecommend_(coord, { approvalId: 'apr-1', recommendation: 'Approve', reason: 'first', checked: ['a', 'b'] }).success, true);
assert.strictEqual(tabs.Recommendations[1][7], 'a; b');                       // a list is joined into plain text
const second = ctx.coordRecommend_(coord, { approvalId: 'apr-1', recommendation: 'Reject', reason: '  second  ', checked: '  Read the quote  ' });
assert.strictEqual(second.success, true);
assert.strictEqual(second.recommendation.recommendation, 'Reject');
const live = tabs.Recommendations.slice(1).filter((r) => r[9] !== 'TRUE');
assert.strictEqual(live.length, 1);
assert.strictEqual(live[0][6], 'second');
assert.strictEqual(live[0][7], 'Read the quote');                              // trimmed free text in column 8
assert.strictEqual(second.recommendation.checked, 'Read the quote');
assert.strictEqual(ctx.coordRecLatest_(tabs.Recommendations)['apr-1'].checked, 'Read the quote');
assert.strictEqual(ctx.coordRecommend_(coord, { approvalId: 'apr-1', recommendation: 'Info', reason: 'r' }).recommendation.checked, ''); // absent -> empty string
assert.strictEqual(ctx.coordRecommend_(coord, { approvalId: 'apr-1', recommendation: 'Info', reason: 'r', checked: 'x'.repeat(600) }).recommendation.checked.length, 500);
tabs.Recommendations.length = 3; tabs.Recommendations[2][9] = ''; tabs.Recommendations[1][9] = 'TRUE'; // back to the two-write state for the checks below
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
const rv = aprRow('apr-7', 'LMS1', cat, 'Revoked'); rv[14] = 'o@lms.org.in'; rv[15] = '2026-10-26T09:00:00.000Z';
assert.strictEqual(ctx.coordTrackRecord_([rec('r7', 'apr-7', me, 'Reject', '2026-10-25T10:00:00.000Z')], [rv], me)[me].byCategory[cat].matched, 1);
// a junk stored Recommendation never breaks the record
const junk = ctx.coordTrackRecord_([rec('j1', 'apr-1', me, 'toString', '2026-10-25T10:00:00.000Z')], apr, null);
assert.deepStrictEqual(JSON.parse(JSON.stringify(junk[me].byCategory[cat])), { made: 1, decided: 1, matched: 0 });
// decided only by a decision AFTER the recommendation: Info Requested at 09:00, Info recommended at 10:00, Owner approves at 11:00
const late = aprRow('apr-8', 'LMS1', cat, 'Info Requested'); late[14] = 'o@lms.org.in'; late[15] = '2026-10-25T09:00:00.000Z';
const infoRec = [rec('i1', 'apr-8', me, 'Info', '2026-10-25T10:00:00.000Z')];
let t8 = ctx.coordTrackRecord_(infoRec, [late], me)[me];
assert.deepStrictEqual(JSON.parse(JSON.stringify(t8.byCategory[cat])), { made: 1, decided: 0, matched: 0 });
assert.strictEqual(t8.recent[0].matched, null);
late[13] = 'Approved'; late[15] = new Date('2026-10-25T11:00:00.000Z');                        // the sheet may hand back a Date
t8 = ctx.coordTrackRecord_(infoRec, [late], me)[me];
assert.deepStrictEqual(JSON.parse(JSON.stringify(t8.byCategory[cat])), { made: 1, decided: 1, matched: 0 });

// ── fresh requests: still open, in scope, no open approval|<id>|... follow-up yet (the adapter waits 1 to 5 days to raise one) ──
const fr = (id, campus, category, status, at, archived) => { const r = aprRow(id, campus, category, status, archived); r[12] = at; return r; };
const AT = '2026-10-25T05:00:00.000Z';
const frRows = [['id'],
  fr('f1', 'LMS1', 'Financial / Purchase', 'Pending', AT),
  fr('f2', 'LMS1', 'Other', 'Info Requested', new Date(AT)),                       // the sheet may hand back a Date
  fr('f3', 'LMS1', 'Other', 'Pending', AT),                                        // has an open follow-up card already
  fr('f4', 'LMS1', 'Other', 'Pending', AT),                                        // its follow-up was resolved by hand: no open row
  fr('f5', 'LMS1', 'Other', 'Pending', AT, 'TRUE'),                                // archived
  fr('f6', 'LMS1', 'Other', 'Approved', AT),                                       // decided
  fr('f7', 'LMS5', 'Other', 'Pending', AT),                                        // outside LMS 1-3
  fr('f8', 'LMS1', 'New/ Backup Position', 'Pending', AT),                         // the adapter raises hiring categories too, so these show
  fr('f9', 'LMS1', 'Other', 'Pending', AT),                                        // an identical copy of f3: the adapter folds it into f3's card
  fr('f10', 'LMS1', 'Other', 'Pending', AT), fr('f11', 'LMS1', 'Other', 'Pending', AT)]; // identical copies, no card yet: one entry
frRows[9][4] = 'Title f3'; frRows[10][4] = frRows[11][4] = 'Copy';
const T = (id, status) => [id, 'approval', 'LMS1', 't', 'd', status, 'medium', '', '', '', '', '', '', '', ''];
const frTasks = [['TaskId'], T('approval|f3|Pending', 'open'), T('approval|f4|Pending', 'resolved'), T('approval|f2|Pending', 'resolved')];
const frLatest = { f1: { by: 'c@lms.org.in', recommendation: 'Approve', reason: 'Quote is fair', checked: 'quote', at: '2026-10-25T06:00:00.000Z' } };
const fresh = JSON.parse(JSON.stringify(ctx.coordFreshApprovals_(frRows, frTasks, ['LMS1', 'LMS2', 'LMS3'], frLatest, [{ email: 'c@lms.org.in', name: 'Test Coord' }])));
assert.deepStrictEqual(fresh.map((f) => f.approvalId), ['f1', 'f2', 'f4', 'f8', 'f10']);
assert.deepStrictEqual(fresh[0], { approvalId: 'f1', campus: 'LMS1', title: 'Title f1', category: 'Financial / Purchase', status: 'Pending', requestedAt: AT,
  recommendation: { by: 'c@lms.org.in', recommendation: 'Approve', reason: 'Quote is fair', at: '2026-10-25T06:00:00.000Z', byName: 'Test Coord' } }); // as coordRecAttach_ builds it
assert.deepStrictEqual([fresh[1].status, fresh[1].requestedAt, fresh[1].recommendation], ['Info Requested', AT, null]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.coordFreshApprovals_(frRows, frTasks, null, {}, []).map((f) => f.approvalId))), ['f1', 'f2', 'f4', 'f7', 'f8', 'f10']); // every campus

// coordinatortasks returns fresh beside tasks; a failure building fresh never breaks the tasks list
ctx.Utilities = { formatDate: (d) => d.toISOString().slice(0, 10) };
ctx.CacheService = { getScriptCache: () => ({ get: () => '1', put() {} }) };                      // every adapter already ran
ctx.coordTransportRetireTasks_ = () => {};                                                           // coordinator-transport.gs is not loaded here
tabs.Tasks = [vm.runInContext('COORD_HEADERS', ctx).slice(), T('approval|apr-1|Pending', 'open')];
tabs.Approvals[2][12] = AT;                                                                          // apr-5, LMS5
const list = JSON.parse(JSON.stringify(ctx.coordTasksList_(coord, 'tok')));
assert.deepStrictEqual(list.tasks.map((x) => x.taskId), ['approval|apr-1|Pending']);
assert.strictEqual(list.tasks[0].recommendation.byName, 'Test Coord');
assert.deepStrictEqual(list.fresh.map((f) => f.approvalId), ['apr-5']);                              // apr-1 already has its card
assert.strictEqual(ctx.coordTasksList_({ email: 'c@lms.org.in', campusId: 'LMS2', roles: ['Coordinator'] }, 'tok').fresh.length, 0); // LMS 1-3 scope
ctx.coordFreshApprovals_ = () => { throw new Error('boom'); };
const safe = ctx.coordTasksList_(coord, 'tok');
assert.strictEqual(safe.success, true);
assert.strictEqual(safe.tasks.length, 1);
assert.strictEqual(safe.fresh.length, 0);
console.log('coordinator recommend: ok');
