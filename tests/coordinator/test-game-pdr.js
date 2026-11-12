// node tests/coordinator/test-game-pdr.js -- lms-game's native "Principals' daily reports" (lane-g): the Coordinator backend's key-gated
// gameCoordPdr* actions over the REAL .gs files and fake sheets. Scope as today's page, no emails out, `since`, issue actions, merge,
// the Owner read-only, and the dispatch line can't catch another lane's game* action. Fake data only.
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');

const KEY = 'g'.repeat(40), SECRET = 'p'.repeat(40);
const rep = (date, campus, email, msg) => [new Date(date + 'T12:00:00Z'), date, campus, email, '6A', '8', 'done ' + campus, 'next', 'regs', msg];
let tabs;
const reset = () => {
  tabs = {
    'Daily Reports': [['at', 'date', 'campus', 'email', 'maClass', 'maScore', 'done', 'tomorrow', 'registers', 'message'],
      rep('2026-11-10', 'LMS1', 'p1@lms.org.in', 'Tank leaking'), rep('2026-11-10', 'LMS2', 'p2@lms.org.in', 'Bus late'), rep('2026-10-01', 'LMS1', 'p1@lms.org.in', 'old one')],
    'LM Studio Tags': [['date', 'campus', 'topics', 'action', 'summary', 'hash', 'at'], ['2026-11-10', 'LMS1', 'Facilities', 'yes', 'tank', 'h', '2026-11-10 20:00']],
    'PDR History': [['date', 'campus']],
    'PDR Issues': [['id', 'campus', 'type', 'subject', 'first', 'last', 'count', 'needs', 'items', 'pushed'],
      ['i1', 'LMS1', 'Facilities', 'Water tank leaking', '2026-11-01', '2026-11-10', '3', 'yes', '[]', '2026-11-10 08:00'],
      ['i2', 'LMS1', 'Facilities', 'Old bench (resolved long ago)', '2026-09-25', '2026-09-30', '2', 'no', '[]', '2026-11-10 08:00'],
      ['i3', 'LMS1', 'Facilities', 'Old but still open', '2026-09-25', '2026-09-30', '2', 'yes', '[]', '2026-11-10 08:00'],
      ['i4', 'LMS1', 'Facilities', 'Tank overflow', '2026-11-05', '2026-11-09', '2', 'yes', '[]', '2026-11-10 08:00'],
      ['i9', 'LMS2', 'Transport', 'Bus late', '2026-11-03', '2026-11-10', '4', 'yes', '[]', '2026-11-10 08:00']],
    'PDR Issue Actions': [['id', 'status', 'assignee', 'assigneeName', 'note', 'by', 'at', 'campus', 'lastAt'],
      ['i1', 'assigned', 'coord@lms.org.in', 'Coord All', 'plumber', 'coord@lms.org.in', '2026-11-10 10:00', 'LMS1', '2026-11-10'],
      ['i2', 'resolved', '', '', 'replaced', 'p1@lms.org.in', '2026-10-01 10:00', 'LMS1', '2026-09-30']],
    'PDR Issue Merges': [['source', 'target', 'by', 'at', 'campus']],
    'PDR Repeats': [['date', 'campus', 'tasks', 'message', 'prev', 'sample']], 'PDR Admissions': [['date', 'campus', 'total', 'registered', 'tc', 'byClass']],
    Emails: [['date', 'campus', 's', 'f', 'body'], ['2026-11-10', 'Kullu', '', '', 'Total Fees Received Today: ₹1,000'], ['2026-10-01', 'Kullu', '', '', 'Total Fees Received Today: ₹9']],
    Tasks: [['TaskId', 'Domain', 'Campus', 'Title', 'Detail', 'Status', 'Severity', 'Created', 'Updated', 'ResolvedAt', 'ResolvedBy', 'Note', 'Department', 'Owner', 'Due']],
  };
};
const allow = [['email', 'name', 'campus', 'roles', 'canApprove'], ['owner@lms.org.in', 'Owner Person', 'ALL', 'Owner', ''],
  ['coord@lms.org.in', 'Coord All', 'ALL', 'Coordinator', ''], ['coord1@lms.org.in', 'Coord One', 'LMS1', 'Coordinator', ''], ['coord4@lms.org.in', 'Coord Four', 'LMS4', 'Coordinator', ''],
  ['fee@lms.org.in', 'Fee Clerk', 'LMS1', 'FeeClerk', ''], ['p1@lms.org.in', 'Principal One', 'LMS1', 'Principal', '']];
const sheetOf = (name) => {
  const t = () => tabs[name];
  const s = {
    getLastRow: () => t().length, getMaxColumns: () => 40,
    getDataRange: () => ({ getValues: () => t().map((r) => r.slice()), getDisplayValues: () => t().map((r) => r.map((x) => (x instanceof Date ? x.toISOString() : String(x)))) }),
    getRange: (r, c, nr, nc) => { nr = nr || 1; nc = nc || 1; const rng = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (t()[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })),
      setValues: (v) => { v.forEach((row, i) => { t()[r - 1 + i] = t()[r - 1 + i] || []; row.forEach((x, j) => { t()[r - 1 + i][c - 1 + j] = x; }); }); return rng; },
      setValue(x) { return rng.setValues([[x]]); }, getValue: () => (t()[r - 1] || [])[c - 1], setNumberFormat() { return rng; }, setFontWeight() { return rng; } }; return rng; },
    appendRow: (row) => { t().push(row); }, insertColumnsAfter() {}, setFrozenRows() {}, deleteRow: (i) => { t().splice(i - 1, 1); },
  };
  return s;
};
const pad = (n) => String(n).padStart(2, '0');
const ctx = {
  console, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, ContentService: {},
  CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ GAME_READ_KEY: KEY, GAME_PEOPLE_SECRET: SECRET })[k] || null }) },
  Utilities: {
    formatDate: (d) => { const x = new Date(d.getTime() + 330 * 60000); return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()); },
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', String(k)).update(String(v)).digest()).map((b) => (b > 127 ? b - 256 : b)),
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  },
  SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: () => allow.map((r) => r.slice()) }) }],
    getSheetByName: (n) => (tabs[n] ? sheetOf(n) : null), insertSheet: (n) => { tabs[n] = []; return sheetOf(n); } }) },
};
vm.createContext(ctx);
['coordinator', 'coordinator-approvals', 'coordinator-pdr', 'coordinator-principal', 'coordinator-recommend', 'coordinator-world', 'supporting-charge'].forEach((f) =>
  vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f + '.gs', 'utf8'), ctx));
const ALL = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
const post = (action, who, params, extra) => JSON.parse(JSON.stringify(ctx.coordGamePdr_(Object.assign({ action, key: KEY, role: 'coordinator', email: who ? who + '@lms.org.in' : null,
  campus: null, campuses: ALL, params: params || {} }, extra))));
let n = 0; const t = (name, fn) => { reset(); fn(); n++; console.log('  ok  - ' + name); };

t('the key is the gate; only the four exact action names', () => {
  assert.deepStrictEqual(post('gameCoordPdr', 'coord', {}, { key: 'x' }), { success: false, error: 'not_authorized' });
  assert.deepStrictEqual(post('gameCoordPdrX', 'coord'), { success: false, error: 'unknown_action' });
});

t('the read: a whole-network coordinator sees every school from `since`; nothing older, no emails anywhere', () => {
  const r = post('gameCoordPdr', 'coord', { since: '2026-11-01' });
  assert.strictEqual(r.data.ok, true);
  assert.deepStrictEqual(r.data.reports.map((x) => x.date + x.campus), ['2026-11-10LMS1', '2026-11-10LMS2']);
  assert.strictEqual(r.data.reports[0].principal, 'Principal One');
  assert.deepStrictEqual(r.data.issues.map((i) => i.id).sort(), ['i1', 'i3', 'i4', 'i9']); // i2: old and resolved; i3: old but still open
  assert.strictEqual(r.data.actions.i1.status, 'assigned');
  assert.strictEqual(r.data.actions.i1.assignee.name, 'Coord All');
  assert.match(r.data.actions.i1.assignee.key, /^[A-Za-z0-9_-]{22}$/);
  assert.deepStrictEqual(r.data.fees.series.map((s) => s[0]), ['2026-11-10']);
  assert.ok(!JSON.stringify(r).includes('@'), 'no email in the answer');
});

t('the read defaults to the last 14 days', () => {
  const r = post('gameCoordPdr', 'coord', {});
  assert.match(r.data.since, /^\d{4}-\d{2}-\d{2}$/);
});

t('scope as today\'s page: a coordinator sees their district (LMS1 → LMS1–3; LMS4 → LMS4–6); the game\'s list narrows it; a Fee Clerk, a Principal, nobody get nothing', () => {
  assert.deepStrictEqual([...new Set(post('gameCoordPdr', 'coord1', { since: '2026-11-01' }).data.reports.map((x) => x.campus))], ['LMS1', 'LMS2']);
  assert.deepStrictEqual(post('gameCoordPdr', 'coord4', { since: '2026-11-01' }).data.reports, []);
  assert.deepStrictEqual(post('gameCoordPdr', 'coord4', { since: '2026-11-01' }).data.issues, []);
  assert.deepStrictEqual([...new Set(post('gameCoordPdr', 'coord', { since: '2026-11-01' }, { campuses: ['LMS2'] }).data.reports.map((x) => x.campus))], ['LMS2']);
  for (const who of ['fee', 'p1', 'nobody', null]) assert.strictEqual(post('gameCoordPdr', who).data.code, 'not_authorized', String(who));
  assert.strictEqual(post('gameCoordPdr', 'coord1', {}, { campuses: ['LMS4'] }).data.code, 'not_authorized'); // none of their schools in the game's list
});

t('one day in full, scoped the same way', () => {
  const d = post('gameCoordPdrDay', 'coord1', { date: '2026-11-10' });
  assert.deepStrictEqual(d.data.reports.map((x) => x.campus), ['LMS1', 'LMS2']);
  assert.deepStrictEqual(post('gameCoordPdrDay', 'coord4', { date: '2026-11-10' }).data.reports, []);
  assert.ok(!JSON.stringify(d).includes('@'));
  assert.strictEqual(post('gameCoordPdrDay', 'coord1', { date: 'x' }).data.code, 'bad_input');
});

t('issue actions: acknowledge, assign to a person key, reopen needs a note; another district\'s issue is refused', () => {
  assert.strictEqual(post('gameCoordPdrIssue', 'coord1', { id: 'i4', status: 'acknowledged' }).data.ok, true);
  const key = post('gameCoordPdr', 'coord', { since: '2026-11-01' }).data.coordinators.find((c) => c.name === 'Coord One').key;
  const a = post('gameCoordPdrIssue', 'coord1', { id: 'i4', status: 'assigned', assignee: key, note: 'please check' });
  assert.strictEqual(a.data.action.assignee.name, 'Coord One');
  assert.strictEqual(tabs['PDR Issue Actions'].find((r) => r[0] === 'i4')[2], 'coord1@lms.org.in'); // the sheet keeps the email, the game never sees it
  assert.strictEqual(post('gameCoordPdrIssue', 'coord1', { id: 'i4', status: 'assigned', assignee: 'nope' }).data.code, 'bad_input');
  assert.strictEqual(post('gameCoordPdrIssue', 'coord1', { id: 'i4', status: 'reopened' }).data.code, 'bad_input');
  assert.strictEqual(post('gameCoordPdrIssue', 'coord4', { id: 'i9', status: 'acknowledged' }).data.code, 'not_authorized');
  assert.strictEqual(post('gameCoordPdrIssue', 'coord1', { id: 'zz', status: 'acknowledged' }).data.code, 'not_found');
});

t('merge: same school only; the Owner reads but never writes here', () => {
  assert.strictEqual(post('gameCoordPdrMerge', 'coord1', { source: 'i4', target: 'i1' }).data.ok, true);
  assert.strictEqual(post('gameCoordPdrMerge', 'coord', { source: 'i4', target: 'i9' }).data.code, 'bad_input');
  assert.strictEqual(post('gameCoordPdr', 'owner', { since: '2026-11-01' }, { role: 'owner' }).data.ok, true);
  assert.strictEqual(post('gameCoordPdrIssue', 'owner', { id: 'i4', status: 'acknowledged' }, { role: 'owner' }).data.code, 'read_only');
});

t('the dispatch line takes exactly these four names and none of another lane\'s game* actions', () => {
  const src = fs.readFileSync(__dirname + '/../../apps-script/coordinator.gs', 'utf8');
  const line = src.split('\n').find((l) => l.includes('coordGamePdr_(body)'));
  const re = new RegExp(/\/(.+?)\/\.test/.exec(line)[1]);
  for (const a of ['gameCoordPdr', 'gameCoordPdrDay', 'gameCoordPdrIssue', 'gameCoordPdrMerge']) assert.ok(re.test(a), a);
  for (const a of ['gameIssues', 'gameIssueResolve', 'gameworld', 'gamecrew', 'gameApprovalAllocate', 'gameApprovalAllocatees', 'gameRecommend', 'gameDecisionPreview', 'gameTrackRecord',
    'gameCoordPdrX', 'gameCoordPdrDays', 'xgameCoordPdr']) assert.ok(!re.test(a), a);
});

console.log(`\n${n} passed`);
