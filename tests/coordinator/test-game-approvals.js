// node tests/coordinator/test-game-approvals.js -- W4 (lane-h): the Coordinator backend's key-gated game* actions for lms-game's native
// Approvals room (allocate, allocatees, recommend, decision preview, track record), over the REAL .gs files and fake sheets. Fake data only.
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');

const KEY = 'g'.repeat(40), SECRET = 'p'.repeat(40);
const head = ['id', 'campusId', 'category', 'urgency', 'title', '', '', '', '', '', '', 'requestedBy', 'requestedAt', 'status', 'by', 'at', 'note', '', 'archived'];
const aprRow = (id, campus, cat, status) => { const r = new Array(19).fill(''); r[0] = id; r[1] = campus; r[2] = cat; r[4] = 'Title ' + id; r[11] = 'principal@lms.org.in';
  r[12] = '2026-11-01T05:00:00.000Z'; r[13] = status; if (status !== 'Pending') { r[14] = 'owner@lms.org.in'; r[15] = '2026-11-05T05:00:00.000Z'; } return r; };
const rec = (id, apr, campus, by, what, at) => [id, apr, campus, 'Financial / Purchase', by, what, 'why ' + id, '', at, ''];
let tabs;
const reset = () => {
  tabs = {
    Approvals: [head, aprRow('apr-1', 'LMS1', 'Financial / Purchase', 'Pending'), aprRow('apr-2', 'LMS2', 'Financial / Purchase', 'Approved'),
      aprRow('apr-3', 'LMS1', 'Other', 'Approved'), aprRow('apr-4', 'LMS1', 'New/ Backup Position', 'Approved')],
    Recommendations: [['RecId', 'ApprovalId', 'Campus', 'Category', 'RecommendedBy', 'Recommendation', 'Reason', 'Checked', 'RecommendedAt', 'Superseded'],
      rec('rec-1', 'apr-1', 'LMS1', 'coord@lms.org.in', 'Approve', '2026-11-02T05:00:00.000Z'), rec('rec-2', 'apr-2', 'LMS2', 'coord@lms.org.in', 'Approve', '2026-11-03T05:00:00.000Z')],
    Tasks: [['TaskId', 'Domain', 'Campus', 'Title', 'Detail', 'Status', 'Severity', 'Created', 'Updated', 'ResolvedAt', 'ResolvedBy', 'Note', 'Department', 'Owner', 'Due']],
  };
};
const allow = [['email', 'name', 'campus', 'roles', 'canApprove'], ['owner@lms.org.in', 'Owner Person', 'ALL', 'Owner', ''],
  ['coord@lms.org.in', 'Coord Decider', 'ALL', 'Coordinator', 'TRUE'], ['coord1@lms.org.in', 'Coord One', 'LMS1', 'Coordinator', ''], ['fee@lms.org.in', 'Fee Clerk', 'LMS1', 'FeeClerk', '']];
const sheetOf = (name) => {
  const s = {
    getLastRow: () => tabs[name].length, getMaxColumns: () => 40,
    getDataRange: () => ({ getValues: () => tabs[name].map((r) => r.slice()) }),
    getRange: (r, c, nr, nc) => { const rng = {
      setValues: (v) => { v.forEach((row, i) => { tabs[name][r - 1 + i] = tabs[name][r - 1 + i] || []; row.forEach((x, j) => { tabs[name][r - 1 + i][c - 1 + j] = x; }); }); return rng; },
      setValue(x) { return rng.setValues([[x]]); }, getValue: () => (tabs[name][r - 1] || [])[c - 1],
      setNumberFormat() { return rng; }, setFontWeight() { return rng; } }; return rng; },
    appendRow: (row) => { tabs[name].push(row); }, insertColumnsAfter() {}, setFrozenRows() {},
  };
  return s;
};
const pad = (n) => String(n).padStart(2, '0'), MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ist = (d) => new Date(d.getTime() + 330 * 60000);
const ctx = {
  console, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, ContentService: {},
  CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ GAME_READ_KEY: KEY, GAME_PEOPLE_SECRET: SECRET })[k] || null }) },
  Utilities: {
    formatDate: (d, _tz, f) => { const x = ist(d); return f === 'yyyy-MM-dd' ? x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()) : x.getUTCDate() + ' ' + MON[x.getUTCMonth()]; },
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', String(k)).update(String(v)).digest()).map((b) => (b > 127 ? b - 256 : b)),
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  },
  SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: () => allow.map((r) => r.slice()) }) }],
    getSheetByName: (n) => (tabs[n] ? sheetOf(n) : null), insertSheet: (n) => { tabs[n] = []; return sheetOf(n); } }) },
};
vm.createContext(ctx);
['coordinator', 'coordinator-approvals', 'coordinator-pdr', 'coordinator-recommend', 'coordinator-world'].forEach((f) =>
  vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f + '.gs', 'utf8'), ctx));

const post = (action, who, extra) => JSON.parse(JSON.stringify(ctx.coordGameApprovals_(Object.assign({ action, key: KEY, email: who ? who + '@lms.org.in' : null, campus: null, campuses: null, params: {} }, extra))));
const data = (r) => { assert.strictEqual(r.success, true, JSON.stringify(r)); return r.data; };
const noEmails = (r, what) => assert.ok(!/@/.test(JSON.stringify(r)), what + ' leaked an email: ' + JSON.stringify(r));
const today = ctx.Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
const later = ctx.Utilities.formatDate(new Date(Date.now() + 5 * 86400000), 'Asia/Kolkata', 'yyyy-MM-dd');
reset();

// gate
assert.deepStrictEqual(post('gameApprovalAllocatees', 'owner', { key: 'nope' }), { success: false, error: 'not_authorized' });
assert.deepStrictEqual(post('gameSomethingElse', 'owner'), { success: false, error: 'unknown_action' });
assert.strictEqual(data(post('gameApprovalAllocatees', null, { campuses: ['LMS1'] })).code, 'not_authorized');
assert.strictEqual(data(post('gameApprovalAllocatees', 'fee', { campuses: ['LMS1'] })).code, 'not_authorized');   // a Fee Clerk: never
assert.strictEqual(data(post('gameApprovalAllocatees', 'coord1', { campuses: ['LMS1'] })).code, 'not_authorized'); // no decide right

// allocatees: {key, name}, no emails
let r = post('gameApprovalAllocatees', 'owner', { campuses: ['LMS1'] });
noEmails(r, 'allocatees');
const people = data(r).people, coordKey = people.find((p) => p.name === 'Coord Decider').key;
assert.deepStrictEqual(people.map((p) => p.name), ['Owner Person', 'Coord Decider', 'Coord One']);

// allocate: the row must be at the proxy's school; the old rules give the codes; the follow-up comes back by name
assert.strictEqual(data(post('gameApprovalAllocate', 'owner', { campus: 'LMS1', params: { id: 'apr-2', assignee: coordKey, due: later } })).code, 'not_authorized');
assert.strictEqual(data(post('gameApprovalAllocate', 'owner', { campus: 'LMS1', params: { id: 'apr-9', assignee: coordKey, due: later } })).code, 'not_found');
assert.strictEqual(data(post('gameApprovalAllocate', 'owner', { campus: 'LMS1', params: { id: 'apr-3', assignee: 'bogus-key-123456', due: later } })).code, 'bad_input');
assert.strictEqual(data(post('gameApprovalAllocate', 'owner', { campus: 'LMS1', params: { id: 'apr-3', assignee: coordKey, due: '2020-01-01' } })).code, 'bad_input');
assert.strictEqual(data(post('gameApprovalAllocate', 'owner', { campus: 'LMS1', params: { id: 'apr-1', assignee: coordKey, due: later } })).code, 'not_approved');
assert.strictEqual(data(post('gameApprovalAllocate', 'owner', { campus: 'LMS1', params: { id: 'apr-4', assignee: coordKey, due: later } })).code, 'hiring');
assert.strictEqual(data(post('gameApprovalAllocate', 'coord1', { campus: 'LMS1', params: { id: 'apr-3', assignee: coordKey, due: later } })).code, 'not_authorized');
assert.strictEqual(data(post('gameApprovalAllocate', 'owner', { campus: 'LMS1', params: { id: 'apr-3', cancel: 'yes' } })).code, 'bad_input');
r = post('gameApprovalAllocate', 'owner', { campus: 'LMS1', params: { id: 'apr-3', assignee: coordKey, due: later, note: 'Buy it' } });
noEmails(r, 'allocate');
assert.deepStrictEqual(data(r), { ok: true, followUp: { assigneeName: 'Coord Decider', due: later, status: 'open', note: 'Buy it' } });
assert.strictEqual(tabs.Approvals[3][19], 'coord@lms.org.in');                         // the sheet keeps the real email (unchanged)
assert.ok(tabs.Tasks.some((t) => t[0] === 'apr_follow|apr-3' && t[13] === 'coord@lms.org.in' && t[14] === later));
assert.deepStrictEqual(data(post('gameApprovalAllocate', 'owner', { campus: 'LMS1', params: { id: 'apr-3', cancel: '1' } })), { ok: true, cancelled: true });
assert.strictEqual(tabs.Approvals[3][19], '');
assert.ok(today <= later);

// recommend: Coordinators only (the Owner decides directly), school checked, supersede unchanged
assert.strictEqual(data(post('gameRecommend', 'owner', { campus: 'LMS1', params: { id: 'apr-1', recommendation: 'Approve', reason: 'ok' } })).code, 'not_authorized');
assert.strictEqual(data(post('gameRecommend', 'coord1', { campus: 'LMS2', params: { id: 'apr-1', recommendation: 'Approve', reason: 'ok' } })).code, 'not_authorized');
assert.strictEqual(data(post('gameRecommend', 'coord', { campus: 'LMS2', params: { id: 'apr-2', recommendation: 'Approve', reason: 'ok' } })).code, 'decided');
assert.strictEqual(data(post('gameRecommend', 'coord1', { campus: 'LMS1', params: { id: 'apr-1', recommendation: 'Maybe', reason: 'ok' } })).code, 'bad_input');
r = post('gameRecommend', 'coord1', { campus: 'LMS1', params: { id: 'apr-1', recommendation: 'Reject', reason: 'Too costly', checked: 'Two quotes' } });
noEmails(r, 'recommend');
const got = data(r).recommendation;
assert.deepStrictEqual([got.byName, got.mine, got.recommendation, got.reason], ['Coord One', true, 'Reject', 'Too costly']);
assert.strictEqual(tabs.Recommendations.filter((x) => x[1] === 'apr-1' && String(x[9]).toUpperCase() !== 'TRUE').length, 1); // one live row

// decision preview: a plain read (no person); the one school only; no requester email, recommender by name
assert.strictEqual(data(post('gameDecisionPreview', null, { campus: 'LMS2', params: { id: 'apr-1' } })).code, 'not_authorized');
assert.strictEqual(data(post('gameDecisionPreview', null, { campus: 'LMS1', params: { id: 'apr-9' } })).code, 'not_found');
r = post('gameDecisionPreview', null, { campus: 'LMS1', params: { id: 'apr-1' } });
noEmails(r, 'preview');
const d = data(r);
assert.ok(d.waitingDays >= 0 && d.history && d.recommendation.byName === 'Coord One');
assert.ok(!('requestedBy' in d));

// track record: the caller's own record only, limited to the proxy's schools (totals and recent alike)
reset(); // coord1's recommendation above superseded coord's apr-1 row (the rule): start from the fixtures
let tr = data(post('gameTrackRecord', 'coord', { campuses: ['LMS1'] }));
assert.deepStrictEqual(tr.recent.map((x) => x.campusCode), ['LMS1']);
assert.deepStrictEqual(tr.byCategory, [{ category: 'Financial / Purchase', made: 1, decided: 0, matched: 0 }]);
tr = data(post('gameTrackRecord', 'coord', { campuses: ['LMS1', 'LMS2'] }));
assert.deepStrictEqual(tr.byCategory, [{ category: 'Financial / Purchase', made: 2, decided: 1, matched: 1 }]);
noEmails(post('gameTrackRecord', 'coord', { campuses: ['LMS1', 'LMS2'] }), 'track record');
assert.deepStrictEqual(data(post('gameTrackRecord', 'owner', { campuses: ['LMS1', 'LMS2'] })), { ok: true, byCategory: [], recent: [] }); // nobody else's, the Owner included
assert.deepStrictEqual(data(post('gameTrackRecord', 'coord', {})).recent, []);                                                          // no school set: nothing

// the doPost route sends exactly these actions here, before the token check
const route = (a) => /^game(ApprovalAlloca|Recommend$|DecisionPreview$|TrackRecord$)/.test(a);
assert.deepStrictEqual(['gameApprovalAllocate', 'gameApprovalAllocatees', 'gameRecommend', 'gameDecisionPreview', 'gameTrackRecord'].map(route), [true, true, true, true, true]);
assert.deepStrictEqual(['gameworld', 'gamecrew', 'gameRecommendX', 'coordinatorrecommend'].map(route), [false, false, false, false]);
assert.ok(fs.readFileSync(__dirname + '/../../apps-script/coordinator.gs', 'utf8').includes("return coordJson_(coordGameApprovals_(body));"));
console.log('game approvals (Coordinator): ok');
