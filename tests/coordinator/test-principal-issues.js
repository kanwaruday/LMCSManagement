// node tests/coordinator/test-principal-issues.js -- the Principal gate, principalissues / principalissueresolve, Coordinator reopen
const fs = require('fs'), vm = require('vm'), assert = require('assert');

// fake workbooks: tabs are arrays of rows (header first)
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

const items = (...dates) => JSON.stringify(dates.map((d) => ({ date: d, text: 'x' })));
const issue = (id, campus, subject, first, last, count, needs) => [id, campus, 'Facilities', subject, first, last, count, needs ? 'yes' : 'no', items(first, last), '2026-10-25 08:00'];
const issueRows = [issue('i1', 'LMS4', 'Water tank leaking', '2026-10-01', '2026-10-10', 3, true),
  issue('i2', 'LMS4', 'Broken bench', '2026-10-02', '2026-10-12', 2, false),
  issue('i3', 'LMS4', 'Tank overflow', '2026-10-05', '2026-10-08', 2, true),
  issue('i9', 'LMS2', 'Bus late', '2026-10-03', '2026-10-09', 4, true)];
const act = (id, status, note, by, at, campus, lastAt) => [id, status, '', '', note, by, at, campus, lastAt || '2026-10-10'];
issueRows[3][9] = '2026-10-25 09:30'; // the latest push, on another campus's row
const actionRows = [act('i1', 'reopened', 'Still leaking', 'c@lms.org.in', '2026-10-21 11:00', 'LMS4'),
  act('i2', 'resolved', 'Bench replaced', 'p4@lms.org.in', '2026-10-20 09:30', 'LMS4', '2026-10-12'),
  act('gone', 'resolved', 'old', 'p4@lms.org.in', '2026-10-01 09:00', 'LMS4')]; // id the Issues tab no longer has
const mergeRows = [['i3', 'i1', 'c@lms.org.in', '2026-10-20 10:00', 'LMS4']];

const clone = (rows) => rows.map((r) => r.slice());
const pdrTabs = { 'PDR Issues': [['Id']].concat(clone(issueRows)), 'PDR Issue Actions': [['Issue id']].concat(clone(actionRows)), 'PDR Issue Merges': [['Source id']].concat(clone(mergeRows)) };
const HEADERS = ['TaskId', 'Domain', 'Campus', 'Title', 'Detail', 'Status', 'Severity', 'CreatedAt', 'LastSeenAt', 'ResolvedAt', 'ResolvedBy', 'Notes', 'Department', 'Assignee', 'Due'];
const task = (id) => ['pdr_issue|' + id, 'pdr_issue', 'LMS4', 't', 'd', 'open', 'medium', '', '', '', '', '', 'Systems', 'c@lms.org.in', ''];
const taskTabs = { Tasks: [HEADERS, task('i1'), task('i2')] };
const allowTabs = { Sheet1: [['email', 'name', 'campus', 'roles', 'canDecide'],
  ['p4@lms.org.in', 'Test P4', 'LMS4', 'Principal'], ['pall@lms.org.in', 'Test PAll', 'ALL', 'Principal'],
  ['plist@lms.org.in', 'Test PList', 'LMS4, LMS5', 'Principal'], ['fc@lms.org.in', 'Test FC', 'LMS4', 'FeeClerk'],
  ['c@lms.org.in', 'Test Coord', 'ALL', 'Coordinator'], ['c4@lms.org.in', 'Test Coord4', 'LMS4', 'Coordinator'], ['t@lms.org.in', 'Test T', 'LMS4', 'Teacher'],
  ['p2@lms.org.in', 'Test P2', 'lms2 ', 'Principal'], ['', 'Blank row', 'LMS4', 'Coordinator, Principal']] }; // a blank email cell must never match

const CLIENT = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';
const tokens = {};
['p4', 'pall', 'plist', 'fc', 'c', 'c4', 't', 'p2', 'nobody'].forEach((u) => { tokens['tok-' + u] = { aud: CLIENT, email_verified: 'true', email: u.toUpperCase() + '@lms.org.in' }; });
tokens['tok-badaud'] = { aud: 'someone-else', email_verified: 'true', email: 'p4@lms.org.in' };
tokens['tok-unverified'] = { aud: CLIENT, email_verified: 'false', email: 'p4@lms.org.in' };
tokens['tok-noemail'] = { aud: CLIENT, email_verified: 'true' };
let fetches = 0;
const cacheStore = {};
const ctx = { console,
  UrlFetchApp: { fetch: (url) => { fetches++; const p = tokens[decodeURIComponent(url.split('id_token=')[1])];
    return { getResponseCode: () => (p ? 200 : 400), getContentText: () => JSON.stringify(p || {}) }; } },
  Utilities: { DigestAlgorithm: { MD5: 'md5' }, computeDigest: (_, s) => s, base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url') },
  CacheService: { getScriptCache: () => ({ get: (k) => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }), MimeType: { JSON: 'json' } } };
vm.createContext(ctx);
['coordinator', 'coordinator-pdr', 'coordinator-principal'].forEach((f) =>
  vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f + '.gs', 'utf8'), ctx));
const books = {}, k = (c) => vm.runInContext(c, ctx); // top-level consts are not ctx properties
books[k('COORD_ALLOWLIST_SHEET_ID')] = book(allowTabs); books[k('COORD_PDR_SHEET_ID')] = book(pdrTabs); books[k('COORD_SHEET_ID')] = book(taskTabs);
ctx.SpreadsheetApp = { openById: (id) => books[id] };
const plain = (x) => JSON.parse(JSON.stringify(x));

// ── coordPrincipalIssues_: merges folded, own action row's status, resolvedBy/At only when resolved ──
const lms4 = plain(ctx.coordPrincipalIssues_(issueRows, actionRows, mergeRows, 'LMS4'));
assert.deepStrictEqual(lms4.map((i) => i.id).sort(), ['i1', 'i2']);
const i1 = lms4.find((i) => i.id === 'i1'), i2 = lms4.find((i) => i.id === 'i2');
assert.deepStrictEqual(Object.keys(i1), ['id', 'subject', 'campus', 'first', 'last', 'count', 'needsAction', 'status', 'assignee', 'resolvedBy', 'resolvedAt', 'note', 'raisedAgain']);
assert.strictEqual(i1.count, 5);                                         // i1 (3) + i3 (2), no shared days
assert.strictEqual(i1.status, 'reopened');
assert.strictEqual(i1.note, 'Still leaking');
assert.strictEqual(i1.resolvedBy, '');
assert.strictEqual(i1.resolvedAt, '');
assert.strictEqual(i1.needsAction, true);
assert.strictEqual(i2.status, 'resolved');
assert.strictEqual(i2.resolvedBy, 'p4@lms.org.in');
assert.strictEqual(i2.resolvedAt, '2026-10-20');
const all = plain(ctx.coordPrincipalIssues_(issueRows, actionRows, mergeRows, null));
assert.deepStrictEqual(all.map((i) => i.id).sort(), ['i1', 'i2', 'i9']);
assert.strictEqual(all.find((i) => i.id === 'i9').status, 'open');       // no action row -> open
assert.strictEqual(all.find((i) => i.id === 'i1').count, 5);
// a merge onto a day both issues were mentioned counts that day once (as the Systems page does)
assert.strictEqual(ctx.coordPrincipalIssues_([issue('a', 'LMS4', 's', '2026-10-01', '2026-10-05', 2, false), issue('b', 'LMS4', 's', '2026-10-05', '2026-10-07', 2, false)],
  [], [['b', 'a', '', '', 'LMS4']], 'LMS4')[0].count, 3);

// ── a Principal (viewer = their email) sees only the notes addressed to them: a reopen reason, or their own closure ──
const nIssues = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id) => issue(id, 'LMS4', 'S ' + id, '2026-10-01', '2026-10-05', 1, false));
const nActs = [act('n1', 'acknowledged', 'coordinator-only ack', 'c@lms.org.in', '2026-10-06 09:00', 'LMS4', '2026-10-05'),
  ['n2', 'assigned', 'c4@lms.org.in', 'Test Coord4', 'coordinator-only assign', 'c@lms.org.in', '2026-10-06 09:00', 'LMS4', '2026-10-05'],
  act('n3', 'reopened', 'Why it was reopened', 'c@lms.org.in', '2026-10-06 09:00', 'LMS4', '2026-10-05'),
  act('n4', 'resolved', 'My outcome', 'p4@lms.org.in', '2026-10-06 09:00', 'LMS4', '2026-10-05'),
  act('n5', 'resolved', 'Coordinator closure', 'c@lms.org.in', '2026-10-06 09:00', 'LMS4', '2026-10-05')];
const notes = (viewer) => { const o = {}; plain(ctx.coordPrincipalIssues_(nIssues, nActs, [], 'LMS4', viewer)).forEach((i) => { o[i.id] = i.note; }); return o; };
assert.deepStrictEqual(notes('p4@lms.org.in'), { n1: '', n2: '', n3: 'Why it was reopened', n4: 'My outcome', n5: '' });
assert.deepStrictEqual(notes(null), { n1: 'coordinator-only ack', n2: 'coordinator-only assign', n3: 'Why it was reopened', n4: 'My outcome', n5: 'Coordinator closure' }); // Coordinator / Owner: unchanged

// ── raised again: a resolved or acknowledged issue mentioned after its action (last > Last mention when updated) is open again ──
const gIssues = [issue('g1', 'LMS4', 'Res', '2026-10-01', '2026-10-12', 3, true), issue('g2', 'LMS4', 'Ack', '2026-10-01', '2026-10-12', 3, true),
  issue('g3', 'LMS4', 'Re', '2026-10-01', '2026-10-12', 3, true), issue('g4', 'LMS4', 'Same', '2026-10-01', '2026-10-10', 3, true)];
const gActs = [act('g1', 'resolved', 'Fixed', 'p4@lms.org.in', '2026-10-10 09:00', 'LMS4'), act('g2', 'acknowledged', '', 'c@lms.org.in', '2026-10-10 09:00', 'LMS4'),
  act('g3', 'reopened', 'Back to you', 'c@lms.org.in', '2026-10-10 09:00', 'LMS4'), act('g4', 'resolved', 'Fixed', 'p4@lms.org.in', '2026-10-10 09:00', 'LMS4')];
const g = {}; plain(ctx.coordPrincipalIssues_(gIssues, gActs, [], 'LMS4', 'p4@lms.org.in')).forEach((i) => { g[i.id] = i; });
assert.deepStrictEqual([g.g1.status, g.g1.raisedAgain, g.g1.resolvedBy, g.g1.resolvedAt], ['open', true, '', '']);
assert.deepStrictEqual([g.g2.status, g.g2.raisedAgain], ['open', true]);
assert.deepStrictEqual([g.g3.status, g.g3.raisedAgain], ['reopened', false]);   // already back with the Principal
assert.deepStrictEqual([g.g4.status, g.g4.raisedAgain, g.g4.resolvedBy], ['resolved', false, 'p4@lms.org.in']); // not mentioned since
assert.strictEqual(g.g1.note, '');                                              // raised again = open: a Principal gets no note on it
assert.strictEqual(i2.raisedAgain, false);

// ── the gate ──
assert.deepStrictEqual(plain(ctx.coordVerifyPrincipal_('tok-p4')), { email: 'p4@lms.org.in', campusId: 'LMS4', principal: true });
const before = fetches;
assert.deepStrictEqual(plain(ctx.coordVerifyPrincipal_('tok-p4')), { email: 'p4@lms.org.in', campusId: 'LMS4', principal: true });
assert.strictEqual(fetches, before);                                     // cached
assert.deepStrictEqual(plain(ctx.coordVerifyPrincipal_('tok-p2')), { email: 'p2@lms.org.in', campusId: 'LMS2', principal: true }); // trimmed, upper-cased
['tok-pall', 'tok-plist', 'tok-fc', 'tok-c', 'tok-c4', 'tok-t', 'tok-nobody', 'tok-badaud', 'tok-unverified', 'tok-missing', '', undefined].forEach((t) =>
  assert.strictEqual(ctx.coordVerifyPrincipal_(t), null, String(t)));
// the Principal cache never feeds the Coordinator gate, and that gate is unchanged
assert.strictEqual(ctx.coordVerifyCaller_('tok-p4'), null);
assert.deepStrictEqual(plain(ctx.coordVerifyCaller_('tok-c')), { email: 'c@lms.org.in', campusId: 'ALL', roles: ['Coordinator'], canDecide: false, feeClerkOnly: false });
assert.strictEqual(ctx.coordVerifyCaller_('tok-fc').feeClerkOnly, true);
assert.strictEqual(ctx.coordVerifyCaller_('tok-badaud'), null);
assert.strictEqual(ctx.coordVerifyCaller_('tok-unverified'), null);
assert.strictEqual(ctx.coordVerifyCaller_('tok-noemail'), null);      // no email never matches the blank allowlist row
assert.strictEqual(ctx.coordVerifyPrincipal_('tok-noemail'), null);
assert.strictEqual(vm.runInContext('coordTokenEmail_', ctx)('tok-noemail'), null);
assert.ok(Object.keys(cacheStore).some((k) => k.indexOf('coordauth_') === 0) && Object.keys(cacheStore).some((k) => k.indexOf('coordprin_') === 0));

// ── routes ──
const get = (action, tok) => ctx.doGet({ parameter: { action: action, idToken: tok } });
const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
const NA = { success: false, error: 'Not authorized' };
let r = get('principalissues', 'tok-p4');
assert.strictEqual(r.success, true);
assert.strictEqual(r.campus, 'LMS4');
assert.deepStrictEqual(r.issues.map((i) => i.id).sort(), ['i1', 'i2']);
r = get('principalissues', 'tok-c');
assert.strictEqual(r.campus, 'ALL');
assert.deepStrictEqual(r.issues.map((i) => i.id).sort(), ['i1', 'i2', 'i9']);
['tok-fc', 'tok-pall', 'tok-plist', 'tok-t', 'tok-badaud', undefined].forEach((t) => assert.deepStrictEqual(get('principalissues', t), NA, String(t)));
// every other action stays shut to a Principal
['coordinatorpdr', 'coordinatortasks', 'coordinatortransport', 'coordinatordecision', 'nope'].forEach((a) => assert.deepStrictEqual(get(a, 'tok-p4'), NA, a));
['coordinatorpdrissue', 'coordinatorpdrmerge', 'coordinatorresolvetask', 'coordinatorrecommend', 'transportclerkcheck'].forEach((a) =>
  assert.deepStrictEqual(post({ action: a, idToken: 'tok-p4', id: 'i1', status: 'resolved' }), NA, a));

// ── resolve: refusals write nothing ──
const snapshot = () => JSON.stringify([pdrTabs, taskTabs.Tasks]);
const s0 = snapshot();
assert.deepStrictEqual(post({ action: 'principalissueresolve', idToken: 'tok-c', id: 'i1', note: 'done' }), NA);       // Coordinators resolve through coordinatorpdrissue
assert.deepStrictEqual(post({ action: 'principalissueresolve', idToken: 'tok-c4', id: 'i1', note: 'done' }), NA);      // ... even one locked to this campus
assert.deepStrictEqual(post({ action: 'principalissueresolve', idToken: 'tok-pall', id: 'i1', note: 'done' }), NA);
assert.deepStrictEqual(post({ action: 'principalissueresolve', idToken: 'tok-p4', id: 'i9', note: 'done' }), NA);       // another campus
assert.deepStrictEqual(post({ action: 'principalissueresolve', idToken: 'tok-p4', id: 'i1', note: '   ' }), { success: false, error: 'Write what was done to close this.' });
assert.deepStrictEqual(post({ action: 'principalissueresolve', idToken: 'tok-p4', id: 'i1' }), { success: false, error: 'Write what was done to close this.' });
assert.deepStrictEqual(post({ action: 'principalissueresolve', idToken: 'tok-p4', id: 'vanished', note: 'done' }), { success: false, error: 'This issue was regrouped by the latest sync; refresh the page' });
assert.strictEqual(snapshot(), s0);

// ── resolve: a good call writes one action row by the Principal and closes the follow-up ──
const actionsBefore = pdrTabs['PDR Issue Actions'].length;
assert.strictEqual(post({ action: 'principalissueresolve', idToken: 'tok-p4', id: 'i1', note: '  Plumber fixed the tank  ' }).success, true);
const acts = pdrTabs['PDR Issue Actions'];
assert.strictEqual(acts.length, actionsBefore);                          // i1's row replaced, not added
const row = acts.filter((a) => a[0] === 'i1');
assert.strictEqual(row.length, 1);
assert.deepStrictEqual(row[0].slice(0, 6).concat(row[0].slice(7)), ['i1', 'resolved', '', '', 'Plumber fixed the tank', 'p4@lms.org.in', 'LMS4', '2026-10-10']);
assert.ok(/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(row[0][6]));
assert.strictEqual(JSON.stringify(acts.filter((a) => a[0] !== 'i1')), JSON.stringify([['Issue id']].concat(actionRows.filter((a) => a[0] !== 'i1'))));
const t1 = taskTabs.Tasks.find((t) => t[0] === 'pdr_issue|i1');
assert.strictEqual(t1[5], 'resolved');
assert.ok(t1[10].indexOf('p4@lms.org.in') === 0);
assert.strictEqual(get('principalissues', 'tok-p4').issues.find((i) => i.id === 'i1').resolvedBy, 'p4@lms.org.in');

// ── reopen: Coordinator, reason required, follow-ups left alone ──
const coord = ctx.coordVerifyCaller_('tok-c');
const s1 = snapshot();
assert.deepStrictEqual(plain(ctx.coordPdrIssueAction_(coord, { id: 'i2', status: 'reopened' })), { success: false, error: "Write why you're reopening this." });
assert.deepStrictEqual(plain(ctx.coordPdrIssueAction_(coord, { id: 'i2', status: 'reopened', note: '  ' })), { success: false, error: "Write why you're reopening this." });
assert.strictEqual(snapshot(), s1);
const re = ctx.coordPdrIssueAction_(coord, { id: 'i2', status: 'reopened', note: 'The bench is still broken' });
assert.strictEqual(re.success, true);
const r2 = pdrTabs['PDR Issue Actions'].find((a) => a[0] === 'i2');
assert.strictEqual(r2[1], 'reopened');
assert.strictEqual(r2[4], 'The bench is still broken');
assert.strictEqual(r2[5], 'c@lms.org.in');
assert.strictEqual(taskTabs.Tasks.find((t) => t[0] === 'pdr_issue|i2')[5], 'open');   // not closed as a "reset"
assert.strictEqual(get('principalissues', 'tok-p4').issues.find((i) => i.id === 'i2').status, 'reopened');
assert.deepStrictEqual(post({ action: 'coordinatorpdrissue', idToken: 'tok-fc', id: 'i2', status: 'reopened', note: 'x' }), NA); // Fee Clerks can't reopen
// the routes apply the viewer: a Principal gets the reopen reason and their own closure, never a Coordinator-only note
assert.strictEqual(get('principalissues', 'tok-p4').issues.find((i) => i.id === 'i2').note, 'The bench is still broken');
assert.strictEqual(get('principalissues', 'tok-p4').issues.find((i) => i.id === 'i1').note, 'Plumber fixed the tank');
assert.strictEqual(ctx.coordPdrIssueAction_(coord, { id: 'i1', status: 'acknowledged', note: 'Coordinator view only' }).success, true);
assert.strictEqual(get('principalissues', 'tok-p4').issues.find((i) => i.id === 'i1').note, '');
assert.strictEqual(get('principalissues', 'tok-c').issues.find((i) => i.id === 'i1').note, 'Coordinator view only');
assert.strictEqual(ctx.coordPdrIssueAction_(coord, { id: 'i1', status: 'resolved', note: 'Closed by the Coordinator' }).success, true);
const i1p = get('principalissues', 'tok-p4').issues.find((i) => i.id === 'i1');
assert.deepStrictEqual([i1p.status, i1p.resolvedBy, i1p.note], ['resolved', 'c@lms.org.in', '']);
assert.strictEqual(get('principalissues', 'tok-c').issues.find((i) => i.id === 'i1').note, 'Closed by the Coordinator');

// ── the actions log: a replaced action row is appended to PDR Issue Actions Log first, so a reopen never loses the closure ──
const logTabs = {}, logBook = book(logTabs);
const v1 = ['x1', 'resolved', '', '', 'Plumber fixed it', 'p4@lms.org.in', '2026-10-20 09:30', 'LMS4', '2026-10-10'];
const v2 = ['x1', 'reopened', '', '', 'Still leaking', 'c@lms.org.in', '2026-10-21 11:00', 'LMS4', '2026-10-10'];
ctx.coordPdrWriteAction_(logBook, v1);
assert.ok(!logTabs['PDR Issue Actions Log'] || logTabs['PDR Issue Actions Log'].length <= 1, 'a first write logs nothing');
ctx.coordPdrWriteAction_(logBook, v2);
assert.deepStrictEqual(logTabs['PDR Issue Actions'].slice(1), [v2]);              // still one row per issue, the latest
const log = logTabs['PDR Issue Actions Log'];
assert.deepStrictEqual(log[0], ['Issue id', 'Status', 'Assignee email', 'Assignee name', 'Note', 'Updated by', 'Updated at', 'CampusId', 'Last mention when updated', 'LoggedAt']);
assert.strictEqual(log.length, 2);
assert.deepStrictEqual(log[1].slice(0, 9), v1);                                  // the outgoing version, as it was
assert.ok(!isNaN(Date.parse(log[1][9])) && /T.*Z$/.test(log[1][9]), 'LoggedAt is ISO');
assert.deepStrictEqual(pdrTabs['PDR Issue Actions Log'].slice(1).map((r) => r[0] + ':' + r[1]), ['i1:reopened', 'i2:resolved', 'i1:resolved', 'i1:acknowledged']); // one per replaced row above

// ── a merged issue's action stores the MERGED last seen, so a close doesn't loop back as "raised again" ──
const mTabs = { 'PDR Issues': [['Id'], issue('ma', 'LMS4', 'Tank', '2026-10-01', '2026-10-05', 2, true), issue('mb', 'LMS4', 'Tank again', '2026-10-06', '2026-10-07', 1, true)],
  'PDR Issue Merges': [['Source id'], ['mb', 'ma', 'c@lms.org.in', '2026-10-08 10:00', 'LMS4']] };
const pdrId = k('COORD_PDR_SHEET_ID'), pdrSaved = books[pdrId];
books[pdrId] = book(mTabs);
const col8 = () => mTabs['PDR Issue Actions'].find((a) => a[0] === 'ma')[8];
const mView = () => plain(ctx.coordPrincipalIssues_(mTabs['PDR Issues'].slice(1).map((r) => r.map(String)), mTabs['PDR Issue Actions'].slice(1), mTabs['PDR Issue Merges'].slice(1), 'LMS4', 'p4@lms.org.in'))[0];
assert.strictEqual(post({ action: 'principalissueresolve', idToken: 'tok-p4', id: 'ma', note: 'Tank replaced' }).success, true);
assert.strictEqual(col8(), '2026-10-07');                                           // mb's later mention, not ma's own 10-05
assert.deepStrictEqual([mView().status, mView().raisedAgain], ['resolved', false]);
assert.strictEqual(ctx.coordPdrIssueAction_(coord, { id: 'ma', status: 'resolved', note: 'Checked on site' }).success, true);
assert.strictEqual(col8(), '2026-10-07');
assert.deepStrictEqual([mView().status, mView().raisedAgain], ['resolved', false]);
ctx.coordPdrResolveFromTask_('ma', coord, 'Resolved from All follow-ups');
assert.strictEqual(col8(), '2026-10-07');
mTabs['PDR Issues'][2][5] = '2026-10-09';                                          // a new mention after the closure
assert.deepStrictEqual([mView().status, mView().raisedAgain], ['open', true]);
assert.strictEqual(ctx.coordPdrMergedLast_('i2', issueRows, mergeRows), '2026-10-12'); // no merges: the row's own last seen
assert.strictEqual(ctx.coordPdrMergedLast_('i1', issueRows, mergeRows), '2026-10-10'); // i3 (10-08) merged in, earlier
books[pdrId] = pdrSaved;
// ── pushedAt: the latest "Pushed at" of the whole Issues tab, the same for every scope ──
['tok-p4', 'tok-p2', 'tok-c', 'tok-c4'].forEach((t) => assert.strictEqual(get('principalissues', t).pushedAt, '2026-10-25 09:30', t));
console.log('coordinator principal issues: ok');
