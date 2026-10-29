// node tests/game/test-kingdom-quests.js -- the Owner's 📜 All quests read (kingdomquests, game-kingdom.gs) and the reassign audit (from -> to).
// Synthetic data only.
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
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-confirm.gs', 'game-office.gs', 'game-buddy.gs', 'game-kingdom.gs', 'game-event.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
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
  const cfg = Object.assign({ confirmQuests: DEFS, kingdom: KINGDOM, setupPeriod: { ownerAssignedQuestsOnly: false } }, cfgExtra || {});
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
const col = (r, name) => r[H.indexOf(name)];
const quests = (c, p) => J(ctx.kingdomQuests_(c, p || {}));
const find = (r, q, campus) => r.rows.find((x) => x.questId === q && x.campus === campus);
const tests = [];
const test = (n, fn) => tests.push([n, fn]);
// a Day Book start.progress answer: LMS3: cash counted, one odometer still only known (so check and odometers are open), LMS4 nothing to count
const DAYBOOK = { progress: { LMS3: { cash: { confirmed: 2, known: 0, total: 2 }, odometer: { confirmed: 0, known: 1, total: 1 } }, LMS4: {} }, states: {}, labels: {}, rings: {}, overall: {} };

test('refuses anyone but the Owner before reading anything', () => {
  reset();
  let read = 0;
  const saved = ctx.cqRead_; ctx.cqRead_ = () => { read++; return []; };
  try {
    for (const c of [COORD, P4, mk({ email: 'v@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS3', viewAs: true })]) {
      assert.deepStrictEqual(quests(c), { success: false, code: 'KINGDOM_NOT_YOURS', error: 'The Kingdom is for the Owner.' });
    }
    assert.strictEqual(read, 0, 'nothing read');
  } finally { ctx.cqRead_ = saved; }
});
test('rows: each cq quest × scope (campus list or network), self and inactive left out; Day Book per school', () => {
  reset();
  ctx.daybookProgress_ = () => DAYBOOK;
  const r = quests(OWN);
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.stuckDays, 7, 'the config default');
  assert.deepStrictEqual(r.sourcesDown, []);
  const ids = r.rows.map((x) => x.questId + '@' + x.campus);
  assert.deepStrictEqual(ids.filter((x) => x.startsWith('tc@')), ['tc@LMS1', 'tc@LMS2', 'tc@LMS3', 'tc@LMS4', 'tc@LMS5', 'tc@LMS6']);
  assert.deepStrictEqual(ids.filter((x) => x.startsWith('tn@')), ['tn@']);
  assert.ok(!ids.some((x) => x.startsWith('toff')), 'inactive quests are not listed');
  assert.deepStrictEqual(ids.filter((x) => x.startsWith('tself')), ['tself@LMS1', 'tself@LMS2', 'tself@LMS3', 'tself@LMS4', 'tself@LMS5', 'tself@LMS6'], 'a self quest: assigned per school (the setup period)');
  assert.deepStrictEqual(ids.filter((x) => x.startsWith('daybook-setup')), ['daybook-setup@LMS3'], 'only schools with something to count');
  const tc = find(r, 'tc', 'LMS4');
  assert.deepStrictEqual([tc.title, tc.roles, tc.state, tc.owner, tc.ownerSince, tc.ageDays, tc.stuck, tc.assignable], ['Campus step', ['Principal'], 'open', null, null, null, false, true]);
  assert.deepStrictEqual(tc.progress, { done: 0, total: 1 });
  assert.deepStrictEqual(tc.assignees, [{ email: 'p4@example.org', name: 'Principal Four' }]);
  assert.strictEqual(tc.go, 'setup/index.html?quest=tc&campus=LMS4');
  assert.deepStrictEqual(find(r, 'tn', '').assignees.map((p) => p.email), ['c1@example.org']);
  const db = find(r, 'daybook-setup', 'LMS3');
  assert.deepStrictEqual([db.state, db.progress, db.assignable, db.owner, db.roles], ['open', { done: 1, total: 5 }, true, null, ['FeeClerk']]);
  assert.strictEqual(db.go, 'office/starting-data.html?campus=LMS3&quest=cash', 'Go opens the first step not done (check)');
});
test('owner, age and stuck: from Setup Data; reassign audit records from -> to', () => {
  reset({ kingdom: Object.assign({ stuckDays: 3 }, KINGDOM) });
  // LMS4: assigned (now), then a reassign; LMS3: a confirmed value 5 days ago, nobody assigned
  const old = new Date(NOW.getTime() - 5 * 86400000).toISOString();
  ctx.cqEnsureTab_(book);
  ctx.gameAppendText_(book.tabs['Setup Data'], [['tc', 'campus:LMS3', 'b', 'name', 'x', 'confirmed', '', old, 'p3@example.org']]);
  ctx.daybookProgress_ = () => DAYBOOK;
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' }).success, true);
  const ALLOW2 = ALLOW.concat([['p4b@example.org', 'Principal Four B', 'LMS4', 'Principal', '']]);
  ALLOW.push(ALLOW2[ALLOW2.length - 1]);
  try {
    assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4b@example.org' }).success, true);
    const done = audit()[audit().length - 1];
    assert.deepStrictEqual([col(done, 'Assignee'), col(done, 'Code'), col(done, 'Result')], ['p4b@example.org', 'reassigned_from:p4@example.org', 'ok'], 'from -> to');
    assert.strictEqual(col(audit()[1], 'Code'), '', 'a first assignment has no from');
    const r = quests(OWN);
    const l4 = find(r, 'tc', 'LMS4'), l3 = find(r, 'tc', 'LMS3');
    assert.deepStrictEqual(l4.owner, { email: 'p4b@example.org', name: 'Principal Four B' });
    assert.strictEqual(l4.ownerSince, NOW.toISOString());
    assert.deepStrictEqual([l4.ageDays, l4.stuck], [0, false], 'an assignment counts as a change');
    assert.deepStrictEqual([l3.owner, l3.ageDays, l3.stuck], [null, 5, true], 'open, nothing for 5 days, stuckDays 3');
    assert.deepStrictEqual(l4.assignees.map((p) => p.email), ['p4@example.org', 'p4b@example.org']);
  } finally { ALLOW.pop(); }
});
test('done rows: not stuck, not assignable', () => {
  reset();
  ctx.cqEnsureTab_(book);
  ctx.gameAppendText_(book.tabs['Setup Data'], [['tc', 'campus:LMS4', 'a', 'name', 'Sample', 'confirmed', '', new Date(NOW.getTime() - 30 * 86400000).toISOString(), 'p4@example.org']]);
  const tc = find(quests(OWN), 'tc', 'LMS4');
  assert.deepStrictEqual([tc.state, tc.stuck, tc.assignable, tc.assignees, tc.ageDays], ['done', false, false, undefined, 30]);
});
test('a source that cannot load: its rows are unknown and named in sourcesDown; never a crash', () => {
  reset();
  ctx.daybookProgress_ = () => { throw new Error('office down'); };
  ctx.CQ_PREFILL['test.one'] = () => { throw new Error('adapter down'); };
  const r = quests(OWN);
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(r.sourcesDown.sort(), ['office', 'setup']);
  assert.ok(r.rows.filter((x) => x.questId === 'tc').every((x) => x.state === 'unknown' && x.stuck === false));
  const db = r.rows.filter((x) => x.questId === 'daybook-setup');
  assert.deepStrictEqual(db.map((x) => x.campus), ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']);
  assert.ok(db.every((x) => x.state === 'unknown' && x.progress === null));
  assert.ok(!logs.some((l) => l.includes('@')), 'logs carry no people');
  // the Game workbook itself failing: a fixed sentence, the raw message only logged
  ctx.daybookProgress_ = () => null;
  const saved = ctx.cqRead_; ctx.cqRead_ = () => { throw new Error('secret detail p4@example.org'); };
  try { assert.deepStrictEqual(quests(OWN), { success: false, code: 'KINGDOM_ERROR', error: 'The quest list could not load. Try again.' }); } finally { ctx.cqRead_ = saved; }
});
test('without the allocate right: rows listed, nothing assignable', () => {
  reset({ kingdom: Object.assign({ rights: { allocate: { roles: [], emails: [] } } }, KINGDOM) });
  const r = quests(OWN);
  assert.ok(r.rows.length && r.rows.every((x) => x.assignable === false && x.assignees === undefined));
});
test('GET-dispatched (a module action); not a write', () => {
  reset();
  assert.strictEqual(ctx.GAME_MODULE_ACTIONS.kingdomquests, ctx.kingdomQuests_);
  const saved = ctx.gameVerifyCaller_;
  ctx.gameVerifyCaller_ = () => J(OWN);
  try {
    const out = JSON.parse(ctx.doGet({ parameter: { idToken: 't', action: 'kingdomquests' } }).body);
    assert.strictEqual(out.success, true);
    assert.strictEqual(setup().length + audit().length, 0, 'nothing written');
  } finally { ctx.gameVerifyCaller_ = saved; }
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 30).join('\n  ')); } }
if (fail) process.exit(1);
