// node tests/game/test-view-as.js -- the Owner's hidden school switcher: asCampus on GET only (game.gs gameViewAs_, doGet, doPost),
// read only, plus the page side (LMCSGame.viewAs in assets/game/game.js, kingdom.js, principal/index.html). Synthetic data only.
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
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-confirm.gs', 'game-office.gs', 'game-buddy.gs', 'game-kingdom.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
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
const tests = [];
const test = (n, fn) => tests.push([n, fn]);
const asGet = (caller, params) => {
  const saved = ctx.gameVerifyCaller_;
  ctx.gameVerifyCaller_ = () => J(caller);
  try { return JSON.parse(ctx.doGet({ parameter: Object.assign({ idToken: 't' }, params) }).body); } finally { ctx.gameVerifyCaller_ = saved; }
};
const asPost = (caller, body) => {
  const saved = ctx.gameVerifyCaller_;
  ctx.gameVerifyCaller_ = () => J(caller);
  try { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ idToken: 't' }, body)) } }).body); } finally { ctx.gameVerifyCaller_ = saved; }
};
const READ_ONLY = { success: false, code: 'GAME_VIEW_READ_ONLY', error: 'Viewing a school as its Principal is read-only. Nothing was changed.' };

test('gameViewAs_: only an Owner, only LMS1-LMS6; a copy, email unchanged', () => {
  reset();
  const own = J(OWN), v = J(ctx.gameViewAs_(own, ' lms3 '));
  assert.deepStrictEqual([v.email, v.primaryRole, v.roles, v.campusId, v.viewAs, v.canDecide, v.functions], ['owner@example.org', 'Principal', ['Principal'], 'LMS3', true, false, []]);
  assert.deepStrictEqual(own.roles, ['Owner'], 'the verified caller is not mutated');
  for (const bad of ['HES', 'LMS9', 'ALL', 'LMS', ['LMS3'], 3]) assert.strictEqual(ctx.gameViewAs_(own, bad), own, String(bad));
  for (const none of [undefined, null, '']) assert.strictEqual(ctx.gameViewAs_(own, none), own);
  for (const c of [P4, COORD]) assert.strictEqual(ctx.gameViewAs_(c, 'LMS3'), c, 'anyone else: ignored');
  assert.ok(warns.length >= 8 && warns.every((w) => w === 'asCampus ignored: GAME_VIEW_AS_IGNORED'), 'logged by code, never people');
});
test('GET as LMS4: the Kingdom answers as that school\'s Principal (own base only, no names)', () => {
  reset();
  const r = asGet(OWN, { action: 'gamekingdom', asCampus: 'LMS4' });
  assert.strictEqual(r.success, true, JSON.stringify(r));
  assert.strictEqual(r.role, 'Principal');
  assert.deepStrictEqual(r.kingdom.campuses.map((c) => c.id), ['LMS4']);
  assert.ok(!JSON.stringify(r).includes('@') && !('cards' in r) && !('heads' in r), 'no Owner-only data');
  const ignored = asGet(P4, { action: 'gamekingdom', asCampus: 'LMS3' });
  assert.deepStrictEqual(ignored.kingdom.campuses.map((c) => c.id), ['LMS4'], 'a Principal\'s asCampus is ignored');
});
test('GET as a school: only read actions answer; every write and Owner-only read is refused, nothing written', () => {
  reset();
  for (const action of ['setupsave', 'gamedecide', 'gametourseen', 'kingdomquests', 'gameeventboard', 'teacherplanactivity', 'nope']) {
    assert.deepStrictEqual(asGet(OWN, { action, asCampus: 'LMS3', quest: 'tc', campus: 'LMS3', item: 'a', windowId: 'trackSuit', tourId: 'x' }), READ_ONLY, action);
  }
  assert.strictEqual(setup().length + audit().length, 0);
  assert.ok(Object.keys(book.tabs).every((t) => t === 'Game Config'), 'no tab created or written');
});
test('GET gametoday as a school is always a peek', () => {
  reset();
  const saved = ctx.gameToday_;
  let seen = null;
  ctx.gameToday_ = (caller, params) => { seen = { caller: J(caller), params: J(params) }; return { success: true }; };
  try {
    asGet(OWN, { action: 'gametoday', asCampus: 'LMS2' });
    assert.deepStrictEqual([seen.caller.viewAs, seen.caller.campusId, seen.caller.primaryRole, seen.params.peek, seen.params.idToken], [true, 'LMS2', 'Principal', '1', 't']);
    asGet(OWN, { action: 'gametoday' });
    assert.ok(!seen.caller.viewAs && seen.params.peek === undefined, 'without asCampus: unchanged');
  } finally { ctx.gameToday_ = saved; }
  assert.ok(/caller\.viewAs \? \[\] : ss\.getSheetByName\('Game Daily'\)/.test(fs.readFileSync(dir + 'game-actions.gs', 'utf8')), 'a view-as peek never reads the Owner\'s own day snapshot');
});
test('POST carrying asCampus: refused before anything runs', () => {
  reset();
  for (const body of [{ action: 'kingdomassign', quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org', asCampus: 'LMS4' },
    { action: 'setupsave', quest: 'tc', campus: 'LMS4', item: 'a', fields: { name: 'x' }, asCampus: 'LMS4' }, { action: 'teachermatchpull', asCampus: 'LMS1' }]) {
    assert.deepStrictEqual(asPost(OWN, body), READ_ONLY, body.action);
  }
  assert.strictEqual(setup().length + audit().length, 0);
  assert.strictEqual(asPost(OWN, { action: 'kingdomassign', quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' }).success, true, 'without it: the write runs');
});
test('page side: sessionStorage only, GETs carry asCampus, no write is sent while viewing', () => {
  const store2 = {};
  const pctx = { console, sessionStorage: { getItem: (k) => (k in store2 ? store2[k] : null), setItem: (k, v) => { store2[k] = String(v); }, removeItem: (k) => { delete store2[k]; } } };
  let posted = 0;
  pctx.fetch = () => { posted++; return Promise.resolve({ json: () => ({}) }); };
  pctx.window = pctx;
  vm.createContext(pctx); vm.runInContext(fs.readFileSync(__dirname + '/../../assets/game/game.js', 'utf8'), pctx);
  const G = pctx.LMCSGame;
  assert.strictEqual(G.viewAs(), null); assert.strictEqual(G.viewParam(), '');
  G.setViewAs({ campus: 'LMS3', name: 'LMS 3' });
  assert.deepStrictEqual(J(G.viewAs()), { campus: 'LMS3', name: 'LMS 3' });
  assert.strictEqual(G.viewParam(), '&asCampus=LMS3');
  G.setViewAs({ campus: 'HES', name: 'x' });
  assert.strictEqual(G.viewAs(), null, 'only LMS1-LMS6 are kept');
  store2['lmcs-view-as'] = '{"campus":"LMS9"}'; assert.strictEqual(G.viewAs(), null);
  store2['lmcs-view-as'] = 'not json'; assert.strictEqual(G.viewAs(), null);
  G.setViewAs({ campus: 'LMS3', name: 'LMS 3' });
  pctx.sessionStorage.getItem = () => { throw new Error('blocked'); }; assert.strictEqual(G.viewAs(), null, 'blocked storage: not viewing');
  const read = (p) => fs.readFileSync(__dirname + '/../../' + p, 'utf8');
  const game = read('assets/game/game.js'), kingdom = read('assets/game/kingdom.js'), page = read('principal/index.html'), ev = read('assets/game/event.js');
  assert.ok(/if \(viewAs\(\)\) return Promise\.resolve\(VIEW_READ_ONLY\)/.test(game), 'postTo sends nothing while viewing');
  assert.ok(/'action=gametoday&idToken=' \+ encodeURIComponent\(session\.idToken \|\| ''\) \+ viewParam\(\)/.test(game), 'gametoday GET carries asCampus');
  assert.ok(/disabled: !!viewAs\(\)/.test(game), 'decision buttons disabled while viewing');
  assert.ok(/if \(viewing\(\)\) return Promise\.reject/.test(ev) && /LMCSGame\.viewParam\(\)/.test(ev) && /disabled: viewing\(\) \? 'disabled' : null/.test(ev), 'event card: GET carries it, no tick sent, button disabled');
  assert.ok(/action=gamekingdom&idToken=' \+ encodeURIComponent\(session\.idToken \|\| ''\) \+ LMCSGame\.viewParam\(\)/.test(page), 'Home Base GET carries it');
  assert.ok(/Viewing ' \+ VIEW\.name \+ ' as the Owner · Game view only/.test(page) && /id="view-leave"/.test(page), 'the thin bar with Leave');
  assert.ok(/!LMCS\.canViewOwnerPortal\(session\)\) \{ LMCSGame\.setViewAs\(null\)/.test(page), 'a non-Owner session drops it');
  assert.ok(!/asCampus/.test(page.replace(/LMCSGame\.viewParam\(\)/g, '')) && !/[?&]asCampus=/.test(kingdom), 'never put in a page URL');
  assert.ok(/LMCSGame\.setViewAs\(\{ campus: b\.id, name: b\.name \}\); location\.assign\(S\.root \+ 'principal\/index\.html'\)/.test(kingdom), 'kingdom: stores the choice, opens the principal page');
  assert.ok(/HOLD_MS = 600/.test(kingdom) && /'contextmenu'/.test(kingdom) && /'Enter as Principal'/.test(kingdom) && /api\.hooks\.base = function/.test(kingdom), 'hold, long-press and the keyboard way in');
  assert.strictEqual(posted, 0);
  // the view ends on any page outside /principal/ that loads game.js (Back or a Go link to the Owner's own pages)
  const load = (pathname) => {
    const st = { 'lmcs-view-as': '{"campus":"LMS3","name":"LMS 3"}' };
    const c = { console, location: { pathname }, sessionStorage: { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } } };
    c.window = c; vm.createContext(c); vm.runInContext(fs.readFileSync(__dirname + '/../../assets/game/game.js', 'utf8'), c);
    return st['lmcs-view-as'] || null;
  };
  for (const p of ['/LMCSManagement/owner/kingdom.html', '/LMCSManagement/owner/index.html', '/LMCSManagement/owner/people.html', '/LMCSManagement/setup/index.html', '/teacher/index.html']) assert.strictEqual(load(p), null, p);
  for (const p of ['/LMCSManagement/principal/index.html', '/principal/']) assert.ok(load(p), p + ' keeps it');
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 12).join('\n  ')); } }
if (fail) process.exit(1);
