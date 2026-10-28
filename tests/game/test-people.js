// node tests/game/test-people.js -- the Owner's People room: peoplelist (GET) and peoplecoordinator (POST) in game-people.gs, and the HQ Home
// / People pages. Synthetic data only; the allowlist is an in-memory sheet.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const store = new Map(), events = [], warns = [], logs = [];
let lockFails = false, fetches = [], fetchReply = null;
function fakeSheet(rows) {
  const sh = {
    rows,
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    getRange: (row, col) => {
      const rg = { setNumberFormat: () => rg, setValues: (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; } };
      return rg;
    },
  };
  return sh;
}
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
const ALLOW = [['email', 'name', 'campus', 'roles', 'canDecide'],
  ['owner@example.org', 'Owner One', 'ALL', 'Owner', 'TRUE'],
  ['p4@example.org', 'Principal Four', 'LMS4', 'Principal', ''],
  ['p3@example.org', 'Principal Three', 'LMS3', 'Principal', ''],
  ['c1@example.org', 'Coordinator One', 'LMS1', 'Coordinator', 'TRUE'],
  ['t4@example.org', 'Teacher Four', 'LMS4', 'Teacher', '']];
const allowBook = { getSheets: () => [fakeSheet(ALLOW)] };
const ctx = {
  console: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)), warn: (m) => warns.push(String(m)) },
  CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, String(v)); }, remove: (k) => { store.delete(k); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_SHEET_ID' ? 'GAME_BOOK' : null) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { if (lockFails) throw new Error('lock'); events.push('lock'); }, releaseLock: () => events.push('unlock') }) },
  UrlFetchApp: { fetch: (url, opts) => {
    events.push('fetch');
    fetches.push({ url, opts });
    if (fetchReply === 'throw') throw new Error('network down');
    if (fetchReply === 'http500') return { getResponseCode: () => 500, getContentText: () => '<html>' };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(fetchReply) };
  } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
};
vm.createContext(ctx);
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-confirm.gs', 'game-office.gs', 'game-buddy.gs', 'game-kingdom.gs', 'game-people.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
ctx.SpreadsheetApp = { openById: (id) => (id === vm.runInContext('GAME_ALLOWLIST_SHEET_ID', ctx) ? allowBook : book) };
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-10-29T05:00:00Z');
ctx.gameNow_ = () => NOW;
ctx.daybookProgress_ = () => null;
ctx.cqDefaults_ = () => ({}); // test definitions only (as test-confirm.js does)
const f = (id) => ({ id, label: id, type: 'text', required: true });
const DEFS = {
  tc: { title: 'Campus step', task: 'Do the campus step', scope: 'campus', roles: ['Principal'], fields: [f('name')], prefill: 'test.one' },
  tn: { title: 'Network step', task: 'Do the network step', scope: 'network', roles: ['Coordinator'], fields: [f('name')], prefill: 'test.one' },
  toff: { title: 'Off', scope: 'campus', roles: ['Principal'], fields: [f('name')], active: false },
  tself: { title: 'Mine', scope: 'self', roles: ['Teacher'], fields: [f('name')] },
};
const KINGDOM = { buildings: [{ id: 'hall', name: 'Hall', where: 'campus', tiers: [{ label: 'Campus step', refs: ['cq:tc'], owners: ['tc'] }] },
  { id: 'post', name: 'Post', where: 'darbar', tiers: [{ label: 'Network step', refs: ['cq:tn'], owners: ['tn'] }] }] };
const reset = (cfgExtra) => {
  const cfg = Object.assign({ confirmQuests: DEFS, kingdom: KINGDOM }, cfgExtra || {});
  book.tabs = { 'Game Config': fakeSheet([['Key', 'Value']].concat(Object.keys(cfg).map((k) => [k, JSON.stringify(cfg[k])]))) };
  events.length = 0; warns.length = 0; logs.length = 0; fetches = []; fetchReply = null; lockFails = false; ctx.CQ_MEMO = null;
  ctx.CQ_PREFILL['test.one'] = () => [{ item: 'a', fields: { name: 'Sample' } }];
};
const mk = (o) => Object.assign({ campusId: 'ALL', idToken: 'tok-' + o.email.split('@')[0] }, o);
const OWN = mk({ email: 'owner@example.org', roles: ['Owner'], primaryRole: 'Owner' });
const COORD = mk({ email: 'c1@example.org', roles: ['Coordinator'], primaryRole: 'Coordinator', campusId: 'LMS1' });
const P4 = mk({ email: 'p4@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS4' });
const P3 = mk({ email: 'p3@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS3' });
const assign = (c, b) => J(ctx.kingdomAssign_(c, b));
const allocate = (c, b) => J(ctx.kingdomAllocate_(c, b));
const rows = (tab) => (book.tabs[tab] ? book.tabs[tab].rows.slice(1) : []);
const setup = () => rows('Setup Data');
const audit = () => rows('Game Allocations');
const H = J(vm.runInContext('KINGDOM_ALLOC_HEADER', ctx));
// the allowlist as the People room sees it: a Functions column after canDecide, found by header
let A = [];
const resetAllow = () => {
  A = [['Email', 'Name', 'Campus', 'Roles', 'CanDecide', 'Functions'],
    ['owner@example.org', 'Owner One', 'ALL', 'Owner', 'TRUE', ''],
    ['c1@example.org', 'Coordinator One', 'LMS1', 'Coordinator', 'TRUE', 'Transport, Payroll'],
    ['c2@example.org', 'Coordinator Two', 'ALL', 'Coordinator, Accounts', '', 'Fees & Accounts'],
    ['oc@example.org', 'Owner Coord', 'ALL', 'Owner, Coordinator', 'TRUE', ''],
    ['p4@example.org', 'Principal Four', 'LMS4', 'Principal', '', '']];
};
const allowSheet = {
  getDataRange: () => ({ getValues: () => A.map((r) => r.slice()) }),
  getLastRow: () => A.length,
  getRange: (row, col, nr, nc) => {
    const rg = { setNumberFormat: () => rg,
      setValues: (vals) => { vals.forEach((v, i) => { const r = A[row - 1 + i] = A[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; },
      setValue: (x) => { A[row - 1][col - 1] = x; return rg; } };
    return rg;
  },
  deleteRow: (n) => { A.splice(n - 1, 1); },
};
ctx.SpreadsheetApp = { openById: (id) => (id === vm.runInContext('GAME_ALLOWLIST_SHEET_ID', ctx) ? { getSheets: () => [allowSheet] } : book) };
const tests = [];
const test = (n, fn) => tests.push([n, fn]);
const col = (r, name) => r[H.indexOf(name)];
const people = (c, b) => J(ctx.peopleCoordinator_(c, b));
const rowOf = (e) => A.find((r) => r[0] === e);
const go = () => { reset(); resetAllow(); };

test('peoplelist: Owner only, refused before reading; Coordinators with functions by header', () => {
  go();
  let opened = 0; const saved = ctx.SpreadsheetApp; ctx.SpreadsheetApp = { openById: () => { opened++; return saved.openById.apply(null, arguments); } };
  try {
    for (const c of [COORD, P4]) assert.deepStrictEqual(J(ctx.peopleList_(c, {})), { success: false, code: 'PEOPLE_NOT_YOURS', error: 'The People room is for the Owner.' });
    assert.strictEqual(opened, 0, 'nothing read');
  } finally { ctx.SpreadsheetApp = saved; }
  const r = J(ctx.peopleList_(OWN, {}));
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(r.coordinators.map((p) => [p.email, p.campus, p.functions, p.editable]),
    [['c1@example.org', 'LMS1', ['Transport', 'Payroll'], true], ['c2@example.org', 'ALL', ['Fees & Accounts'], false], ['oc@example.org', 'ALL', [], false]]);
  assert.deepStrictEqual([r.canEdit, r.hasFunctions, r.campuses[0]], [true, true, 'ALL']);
  assert.ok(!('peoplecoordinator' in ctx.GAME_MODULE_ACTIONS) && ctx.GAME_MODULE_ACTIONS.peoplelist === ctx.peopleList_, 'the write is POST only');
});
test('add: a new Coordinator row, plain text, two audit rows', () => {
  go();
  const r = people(OWN, { email: ' New.Person@Example.org ', name: 'New Person', campus: 'lms3', functions: ['Transport', 'Fees & Accounts', 'Transport'] });
  assert.strictEqual(r.success, true, JSON.stringify(r));
  assert.deepStrictEqual(rowOf('new.person@example.org'), ['new.person@example.org', 'New Person', 'LMS3', 'Coordinator', '', 'Fees & Accounts, Transport']);
  assert.deepStrictEqual(audit().map((x) => [col(x, 'Action'), col(x, 'Source'), col(x, 'SourceId'), col(x, 'Phase'), col(x, 'Result'), col(x, 'Code')]),
    [['people_coordinator', 'allowlist', 'new.person@example.org', 'requested', '', ''], ['people_coordinator', 'allowlist', 'new.person@example.org', 'done', 'ok', 'added']]);
  assert.deepStrictEqual(r.coordinator.functions, ['Fees & Accounts', 'Transport']);
  assert.strictEqual(people(OWN, { email: 'x@example.org', campus: 'LMS3', functions: [] }).code, 'PEOPLE_BAD_NAME', 'a new person needs a name');
});
test('change: campus and functions only; functions outside the room are kept; unchanged is a no-op', () => {
  go();
  const r = people(OWN, { email: 'c1@example.org', name: 'Ignored Rename', campus: 'ALL', functions: ['HR'] });
  assert.strictEqual(r.success, true, JSON.stringify(r));
  assert.deepStrictEqual(rowOf('c1@example.org'), ['c1@example.org', 'Coordinator One', 'ALL', 'Coordinator', 'TRUE', 'Payroll, HR'], 'name and canDecide untouched; Payroll kept');
  const again = people(OWN, { email: 'c1@example.org', campus: 'ALL', functions: ['HR'] });
  assert.strictEqual(again.unchanged, true);
  assert.strictEqual(col(audit()[audit().length - 1], 'Code'), 'unchanged');
  // a row with no roles yet gets the Coordinator role
  A.push(['blank@example.org', 'Blank', 'LMS2', '', '', '']);
  assert.strictEqual(people(OWN, { email: 'blank@example.org', campus: 'LMS2', functions: [] }).success, true);
  assert.strictEqual(rowOf('blank@example.org')[3], 'Coordinator');
});
test('never: an Owner row, a row with other roles, granting Owner, a duplicate email', () => {
  go();
  const before = JSON.stringify(A);
  assert.strictEqual(people(OWN, { email: 'owner@example.org', campus: 'LMS1', functions: [] }).code, 'PEOPLE_OWNER_ROW');
  assert.strictEqual(people(OWN, { email: 'oc@example.org', remove: true }).code, 'PEOPLE_OWNER_ROW');
  assert.strictEqual(people(OWN, { email: 'c2@example.org', campus: 'LMS1', functions: [] }).code, 'PEOPLE_OTHER_ROLES');
  assert.strictEqual(people(OWN, { email: 'p4@example.org', campus: 'LMS4', functions: [] }).code, 'PEOPLE_OTHER_ROLES', 'a Principal is not turned into a Coordinator here');
  assert.strictEqual(people(OWN, { email: 'c1@example.org', campus: 'LMS1', functions: ['Owner'] }).code, 'KINGDOM_BAD_INPUT');
  assert.strictEqual(people(OWN, { email: 'c1@example.org', campus: 'LMS1', roles: 'Owner', functions: [] }).success, true, 'a roles field is ignored');
  assert.strictEqual(rowOf('c1@example.org')[3], 'Coordinator');
  A.push(['dup@example.org', 'D', 'LMS1', 'Coordinator', '', ''], ['DUP@example.org', 'D2', 'LMS2', 'Coordinator', '', '']);
  assert.strictEqual(people(OWN, { email: 'dup@example.org', campus: 'LMS1', functions: [] }).code, 'PEOPLE_DUPLICATE');
  A.splice(-2, 2);
  assert.strictEqual(JSON.stringify(A.filter((r) => r[0] !== 'c1@example.org')), JSON.stringify(JSON.parse(before).filter((r) => r[0] !== 'c1@example.org')), 'nothing else changed');
  assert.ok(audit().filter((x) => col(x, 'Result') === 'refused').length >= 6, 'refusals audited');
});
test('remove: deletes a Coordinator-only row; not found refused', () => {
  go();
  assert.deepStrictEqual(people(OWN, { email: 'c1@example.org', remove: true }), { success: true, removed: true });
  assert.strictEqual(rowOf('c1@example.org'), undefined);
  assert.strictEqual(rowOf('owner@example.org')[3], 'Owner', 'the other rows stay');
  assert.strictEqual(people(OWN, { email: 'c1@example.org', remove: true }).code, 'PEOPLE_NOT_FOUND');
  assert.strictEqual(col(audit()[1], 'Action'), 'people_coordinator_remove');
});
test('input checks and rights: refused before any write', () => {
  go();
  const before = JSON.stringify(A);
  for (const [b, code] of [[{ email: 'not-an-email', campus: 'LMS1' }, 'PEOPLE_BAD_EMAIL'], [{ email: '=cmd@example.org', campus: 'LMS1' }, 'PEOPLE_BAD_EMAIL'],
    [{ email: 'a b@example.org', campus: 'LMS1' }, 'PEOPLE_BAD_EMAIL'], [{ email: 'n@example.org', name: 'N', campus: 'HES' }, 'KINGDOM_BAD_INPUT'],
    [{ email: 'n@example.org', name: 'N', campus: 'LMS1', functions: 'Transport' }, 'KINGDOM_BAD_INPUT'], [{ email: 'n@example.org', name: '=HYPERLINK("x")', campus: 'LMS1' }, 'PEOPLE_BAD_NAME'],
    [{ email: 'n@example.org', name: 'N', campus: 'LMS1', remove: 'yes' }, 'KINGDOM_BAD_INPUT'], [{ email: 'n@example.org', name: 'Aadhaar 123456789012', campus: 'LMS1' }, 'PEOPLE_BAD_NAME']]) {
    assert.strictEqual(people(OWN, b).code, code, JSON.stringify(b));
  }
  assert.strictEqual(people(COORD, { email: 'n@example.org', name: 'N', campus: 'LMS1' }).code, 'KINGDOM_NO_RIGHT');
  assert.strictEqual(people(Object.assign({}, OWN, { viewAs: true, roles: ['Principal'], primaryRole: 'Principal' }), { email: 'n@example.org', name: 'N', campus: 'LMS1' }).code, 'KINGDOM_NO_RIGHT');
  reset({ kingdom: Object.assign({ rights: { allocate: { roles: [], emails: [] } } }, KINGDOM) });
  assert.strictEqual(people(OWN, { email: 'n@example.org', name: 'N', campus: 'LMS1' }).code, 'KINGDOM_NO_RIGHT', 'an Owner without the allocate right');
  assert.strictEqual(JSON.stringify(A), before);
  lockFails = true;
  assert.strictEqual(people(OWN, { email: 'n@example.org', name: 'N', campus: 'LMS1' }).code, 'KINGDOM_NO_RIGHT');
  reset(); lockFails = true;
  assert.strictEqual(people(OWN, { email: 'n@example.org', name: 'N', campus: 'LMS1' }).code, 'KINGDOM_BUSY');
  assert.strictEqual(JSON.stringify(A), before);
  assert.ok(!logs.concat(warns).some((l) => l.includes('@')), 'logs carry no people');
});
test('no Functions column: functions refused, campus still settable', () => {
  go();
  A = A.map((r) => r.slice(0, 5));
  assert.strictEqual(people(OWN, { email: 'c1@example.org', campus: 'LMS2', functions: ['HR'] }).code, 'PEOPLE_NO_FUNCTIONS_COLUMN');
  assert.strictEqual(people(OWN, { email: 'c1@example.org', campus: 'LMS2', functions: [] }).success, true);
  assert.strictEqual(rowOf('c1@example.org')[2], 'LMS2');
  assert.strictEqual(J(ctx.peopleList_(OWN, {})).hasFunctions, false);
});
test('POST dispatch; a GET is refused as unknown', () => {
  go();
  const saved = ctx.gameVerifyCaller_;
  ctx.gameVerifyCaller_ = () => J(OWN);
  try {
    assert.deepStrictEqual(JSON.parse(ctx.doGet({ parameter: { idToken: 't', action: 'peoplecoordinator', email: 'n@example.org', name: 'N', campus: 'LMS1' } }).body), { success: false, error: 'Unknown action' });
    const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'peoplecoordinator', idToken: 't', email: 'n@example.org', name: 'N', campus: 'LMS1', functions: [] }) } }).body);
    assert.strictEqual(r.success, true, JSON.stringify(r));
  } finally { ctx.gameVerifyCaller_ = saved; }
});
test('pages: HQ Home tiles and switch; People room confirms before every write', () => {
  const read = (p) => fs.readFileSync(__dirname + '/../../' + p, 'utf8');
  const home = read('owner/index.html'), pp = read('owner/people.html'), kg = read('owner/kingdom.html');
  for (const t of ["e: '📥', name: 'Approvals'", "e: '💰', name: 'Money today'", "e: '👥', name: 'People'", "e: '⚙️', name: 'Game settings'"]) assert.ok(home.includes(t), t);
  assert.ok(/url: 'kingdom\.html#base-HES'/.test(home) && /'Set up the game: ' \+ done \+ ' of ' \+ steps\.length \+ ' done'/.test(home), 'Game settings: x of 6 done, opens the HQ base');
  assert.ok(home.includes('id="modules"'), 'the tools shelf stays');
  for (const [page, cur] of [[home, 'index.html'], [kg, 'kingdom.html']]) assert.ok(page.includes('<nav class="gb-hsw" aria-label="Owner views">') && page.includes('href="' + cur + '" aria-current="page"'), 'header switch, ' + cur + ' current');
  assert.ok(/LMCS\.canViewOwnerPortal\(session\)/.test(pp) && /action=peoplelist/.test(pp) && /action: 'peoplecoordinator'/.test(pp), 'People: Owner gate, read, write');
  assert.strictEqual((pp.match(/method: 'POST'/g) || []).length, 1, 'one write path');
  assert.ok(/go\.onclick = function \(\) \{\s*if \(BUSY\) return;/.test(pp) && /\['Confirm'\]/.test(pp), 'the write runs only from Confirm');
  assert.ok(!/innerHTML/.test(pp), 'People: text nodes only');
  assert.ok(read('tools/stamp-assets.mjs').includes("'owner/people.html'") && read('assets/game/guide.js').includes("'owner/people.html'") && read('tests/datasrc/test-datasrc.js').includes("'owner/people.html'"), 'stamped, guided, exempt');
  assert.ok(/baseOfGo\(location\.hash\)/.test(read('assets/game/kingdom.js')), 'the Kingdom opens #base-HES from HQ Home');
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 14).join('\n  ')); } }
if (fail) process.exit(1);
