// node tests/pdr/test-game-actions.js -- Wave 1: lms-game's key-gated game* actions (principal-dr.gs pdrGame_, teacher-ss.gs,
// coordinator-principal.gs coordGameIssues_ / coordGameIssueResolve_). Fake data only: this repo is public.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { boot } = require('./harness');

const ROOT = path.join(__dirname, '..', '..', 'apps-script');
const PDR_SHEET = '1GzGdakmjjkou0GGgljY6ugXvOM21MLkyeyc85Ke3i1Y';
const EMP_SHEET = '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0';
const KEY = 'test-game-key';

const env = boot({
  books: {
    [PDR_SHEET]: {
      'Daily Reports': [['Timestamp', 'Date', 'CampusId', 'PrincipalEmail', 'MA_ClassOrHouse', 'MA_Score', 'TasksCompleted', 'TasksForTomorrow', 'RegistersCrosschecked', 'ImportantMessage'],
        [new Date(), '2026-11-10', 'LMS4', 'p4@example.org', '', '', '', 'Check water tank, Call parent', '', '']],
      'Planned Activities': [['Id', 'CampusId', 'Title', 'DueDate', 'Assignee', 'CreatedAt', 'CreatedBy', 'Status', 'CompletedAt'],
        ['pa-1', 'LMS4', 'Science fair', '2099-01-05', 'Staff A', '', '', 'Active', ''],
        ['pa-2', 'LMS2', 'Other school', '2099-01-05', '', '', '', 'Active', '']],
    },
    [EMP_SHEET]: { EmpMaster: [['EmployeeCode', 'Name', 'Status'], ['NCM/1', 'Test Teacher A', 'Active'], ['KEL/1', 'Test Teacher B', 'Active']],
      EmpSalary: [['EmployeeCode', 'Department'], ['NCM/1', 'Teaching'], ['KEL/1', 'Teaching']] },
  },
  allowlistRows: [['Email', 'Name', 'CampusId', 'Role', 'CanApprove']],
});
const g = env.g;
g.CalendarApp = { getCalendarById: () => null };
const paSheet = env.books[PDR_SHEET].getSheetByName('Planned Activities'); // the payroll harness's fake sheet has no appendRow
paSheet.appendRow = (row) => paSheet.getRange(paSheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
new vm.Script(fs.readFileSync(path.join(ROOT, 'principal-dr.gs'), 'utf8'), { filename: 'principal-dr.gs' }).runInContext(g);
let props = {};
g.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) };
// the body lms-game's classic proxy sends (classic-proxy-contract.md §4); email only on writes
const P = (action, params, o) => Object.assign({ action, key: KEY, role: 'principal', campus: 'LMS4', email: null, params: params || {} }, o || {});
const W = (action, params, o) => P(action, params, Object.assign({ email: 'p4@example.org' }, o || {}));
const send = (body) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const NO = { success: false, error: 'not_authorized' };
const data = (body) => { const r = send(body); assert.strictEqual(r.success, true, JSON.stringify(r)); return r.data; };

// ── the key gate: unset property, missing, wrong, or another length all refuse ──
assert.deepStrictEqual(send(P('gamePdrLoad', { date: '2026-11-11' })), NO);  // GAME_KEY unset
props.GAME_KEY = KEY;
[undefined, '', 'wrong-key-xx', KEY + 'x', 42].forEach((k) => assert.deepStrictEqual(send(P('gamePdrLoad', { date: '2026-11-11' }, { key: k })), NO, String(k)));
// one school, a known role; writes need the Principal and an email
[{ campus: 'ALL' }, { campus: 'LMS7' }, { campus: '' }, { role: 'teacher' }, { role: '' }].forEach((bad) =>
  assert.deepStrictEqual(send(P('gamePdrLoad', { date: '2026-11-11' }, bad)), NO, JSON.stringify(bad)));
assert.deepStrictEqual(send(W('gamePdrSave', { date: '2026-11-11', next1: 'x' }, { role: 'owner' })), NO);
assert.deepStrictEqual(send(P('gamePdrSave', { date: '2026-11-11', next1: 'x' })), NO);           // no email
// only this file's actions take this path; any other game* action (another lane's) still needs a real ID token
assert.deepStrictEqual(send(P('gameApprovalsList')), { success: false, error: 'Not authorized' });
assert.deepStrictEqual(send(P('gamePdrNope')), NO); // a gamePdr* name that isn't a route
assert.deepStrictEqual(send(Object.assign(P('savedailyreport'), { campusId: 'LMS4', date: '2026-11-11' })), { success: false, error: 'Not authorized' });

// ── load (Principal or Owner): yesterday's tasks walk back, planned + month for this campus only ──
let d = data(P('gamePdrLoad', { date: '2026-11-11' }));
assert.deepStrictEqual(Object.keys(d), ['report', 'sessions', 'yesterdaysTasks', 'dayLabel', 'planned', 'month']);
assert.deepStrictEqual(d.report, { exists: false });
assert.deepStrictEqual(d.yesterdaysTasks, ['Check water tank', 'Call parent']);
assert.deepStrictEqual(d.planned.map((a) => a.id), ['pa-1']);
assert.strictEqual(data(P('gamePdrLoad', { date: '2026-11-11' }, { role: 'owner' })).planned.length, 1);
assert.deepStrictEqual(data(P('gamePdrLoad', { date: '11/11/26' })), { ok: false, code: 'bad_input' });

// ── save: lists rebuilt from done1.., next1.., …, always this campus, email stamped ──
assert.deepStrictEqual(data(W('gamePdrSave', { date: '2026-11-11', maClass: 'C-5', maScore: '8', done1: 'Check water tank', next1: 'Meet bus driver', next2: 'Call parent', reg1: 'Gate Register', next4: 'skipped: gap' })), { ok: true });
const dr = env.books[PDR_SHEET].getSheetByName('Daily Reports').getDataRange().getValues();
assert.deepStrictEqual(dr[dr.length - 1].slice(1), ['2026-11-11', 'LMS4', 'p4@example.org', 'C-5', '8', 'Check water tank', 'Meet bus driver, Call parent', 'Gate Register', '']);
d = data(P('gamePdrLoad', { date: '2026-11-11' }));
assert.deepStrictEqual([d.report.exists, d.report.maScore, d.report.tasksForTomorrow], [true, '8', ['Meet bus driver', 'Call parent']]);

// ── planned activities: add / complete / delete, campus-scoped ids ──
const act = data(W('gamePdrAddPlanned', { title: 'Annual day', dueDate: '2099-02-01', assignee: '' }));
assert.deepStrictEqual([act.activity, act.completed], ['Annual day', false]);
assert.deepStrictEqual(data(W('gamePdrSetPlanned', { id: act.id, completed: 'true' })), { ok: true });
assert.deepStrictEqual(data(W('gamePdrSetPlanned', { id: 'pa-2', completed: 'true' })), { ok: false, code: 'not_found' }); // LMS2's
assert.deepStrictEqual(data(W('gamePdrDelPlanned', { id: act.id })), { ok: true });
assert.deepStrictEqual(data(P('gamePdrLoad', { date: '2026-11-11' })).planned.map((a) => a.id), ['pa-1']);

// ── SS: the form for this campus only, labels without a separate name; a submit can't name another school's staff ──
const f = data(P('gameSsMeta', { role: 'teacher' }));
assert.deepStrictEqual(f.employees.map((e) => Object.keys(e)), [['employeeId', 'label']]);
assert.deepStrictEqual(f.employees.map((e) => e.employeeId), ['NCM/1']);
const scores = f.rubricTitles.map(() => '5').join(',');
assert.deepStrictEqual(data(W('gameSsSubmit', { role: 'teacher', employeeId: 'KEL/1', scores })), { ok: false, code: 'not_a_choice' });
assert.deepStrictEqual(data(W('gameSsSubmit', { role: 'teacher', employeeId: 'NCM/1', scores: '5,5' })), { ok: false, code: 'bad_input' });
assert.deepStrictEqual(data(W('gameSsSubmit', { role: 'teacher', employeeId: 'NCM/1', scores })), { ok: true });

// ── issues (Coordinator project): GAME_READ_KEY, one campus, the Principal's view of notes ──
// same fake workbook as tests/coordinator/test-principal-issues.js
const book = (tabs) => {
  const sheetOf = (name) => { const t = tabs[name]; return {
    getLastRow: () => t.length,
    getDataRange: () => ({ getValues: () => t.map((r) => r.slice()), getDisplayValues: () => t.map((r) => r.map((x) => String(x))) }),
    getRange: (r, c, nr, nc) => { nr = nr || 1; nc = nc || 1; const rng = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (t[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })),
      getValue: () => rng.getValues()[0][0],
      setValues: (v) => { v.forEach((row, i) => { t[r - 1 + i] = t[r - 1 + i] || []; row.forEach((x, j) => { t[r - 1 + i][c - 1 + j] = x; }); }); return rng; },
      setValue: (x) => rng.setValues([[x]]),
      setNumberFormat: () => rng, setFontWeight: () => rng }; return rng; },
    appendRow: (row) => { t.push(row.slice()); },
    setFrozenRows() {} }; };
  return { getSheets: () => [sheetOf(Object.keys(tabs)[0])], getSheetByName: (n) => tabs[n] ? sheetOf(n) : null, insertSheet: (n) => { tabs[n] = []; return sheetOf(n); } };
};

const days = (a, b) => JSON.stringify([{ date: a }, { date: b }]);
const pdrTabs = { 'PDR Issues': [['Id'], ['i1', 'LMS4', 'F', 'Water tank leaking', '2026-10-01', '2026-10-10', 3, 'yes', days('2026-10-01', '2026-10-10')],
  ['i9', 'LMS2', 'F', 'Bus late', '2026-10-03', '2026-10-09', 4, 'yes', days('2026-10-03', '2026-10-09')]],
  'PDR Issue Actions': [['Issue id'], ['i1', 'acknowledged', '', '', 'Coordinator view only', 'c@example.org', '2026-10-11 09:00', 'LMS4', '2026-10-10']],
  'PDR Issue Merges': [['Source id']] };
const c = { console, LockService: g.LockService, CacheService: g.CacheService };
vm.createContext(c);
['coordinator', 'coordinator-pdr', 'coordinator-world', 'coordinator-principal', 'supporting-charge'].forEach((f) =>
  new vm.Script(fs.readFileSync(path.join(ROOT, f + '.gs'), 'utf8'), { filename: f + '.gs' }).runInContext(c));
const pdrId = vm.runInContext('COORD_PDR_SHEET_ID', c);
c.SpreadsheetApp = { openById: (x) => (x === pdrId ? book(pdrTabs) : book({ Tasks: [['TaskId']] })) };
let cprops = {};
c.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in cprops ? cprops[k] : null) }) };
const plain = (x) => JSON.parse(JSON.stringify(x));
let r;
const C = (o) => Object.assign({ key: KEY, role: 'principal', campus: 'LMS4', email: 'p4@example.org', params: {} }, o || {});
assert.deepStrictEqual(plain(c.coordGameIssues_(C())), NO); // GAME_READ_KEY unset
cprops.GAME_READ_KEY = KEY;
assert.deepStrictEqual(plain(c.coordGameIssues_(C({ key: 'nope' }))), NO);
assert.deepStrictEqual(plain(c.coordGameIssues_(C({ campus: 'ALL' }))), NO);
assert.deepStrictEqual(plain(c.coordGameIssues_(C({ role: 'coordinator' }))), NO);
r = plain(c.coordGameIssues_(C()));
assert.deepStrictEqual([r.success, r.data.map((i) => i.id)], [true, ['i1']]);
assert.deepStrictEqual(Object.keys(r.data[0]), ['id', 'subject', 'first', 'last', 'count', 'needsAction', 'status', 'note', 'raisedAgain', 'resolvedAt']);
assert.strictEqual(r.data[0].note, '');                                                   // a Coordinator-only note never reaches the Principal
assert.strictEqual(plain(c.coordGameIssues_(C({ email: null }))).data[0].note, '');       // ... even with no email
assert.strictEqual(plain(c.coordGameIssues_(C({ role: 'owner', email: null }))).data[0].note, 'Coordinator view only'); // the Owner sees every note
assert.deepStrictEqual(plain(c.coordGameIssueResolve_(C({ params: { id: 'i9', note: 'done' } }))), NO);                   // another campus
assert.deepStrictEqual(plain(c.coordGameIssueResolve_(C({ role: 'owner', params: { id: 'i1', note: 'done' } }))), NO);    // the Owner doesn't close
assert.deepStrictEqual(plain(c.coordGameIssueResolve_(C({ email: null, params: { id: 'i1', note: 'done' } }))), NO);
assert.deepStrictEqual(plain(c.coordGameIssueResolve_(C({ params: { id: 'i1', note: ' ' } }))), { success: true, data: { ok: false, code: 'note_needed' } });
assert.deepStrictEqual(plain(c.coordGameIssueResolve_(C({ params: { id: 'gone', note: 'x' } }))), { success: true, data: { ok: false, code: 'regrouped' } });
assert.deepStrictEqual(plain(c.coordGameIssueResolve_(C({ params: { id: 'i1', note: 'Plumber fixed it' } }))), { success: true, data: { ok: true } });
const a = pdrTabs['PDR Issue Actions'].find((x) => x[0] === 'i1');
assert.deepStrictEqual([a[1], a[4], a[5]], ['resolved', 'Plumber fixed it', 'p4@example.org']);
console.log('test-game-actions: ok');
