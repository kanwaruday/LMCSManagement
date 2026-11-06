// node tests/game/test-kingdom-heads.js -- the Kingdom follow-up with no alliance heads: gamekingdom's followCoordinators fallback
// (game-kingdom.gs), the Owner's kingdomsethead write (game-kingdom-heads.gs), and kingdom.js nextAction offering the card. Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const J = (x) => JSON.parse(JSON.stringify(x));
const load = (ctx, files) => { vm.createContext(ctx); files.forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx)); return ctx; };
const ALLOW = [['email', 'name', 'campus', 'roles', 'canDecide'],
  ['owner@example.org', 'Owner One', 'ALL', 'Owner', 'TRUE'],
  ['c1@example.org', 'Coordinator One', 'ALL', 'Coordinator', 'TRUE'],
  ['C1@example.org', 'Coordinator One again', 'ALL', 'Coordinator', ''],
  ['c2@example.org', 'Coordinator Two', 'LMS1', 'Teacher, Coordinator', ''],
  ['p4@example.org', 'Principal Four', 'LMS4', 'Principal', '']];
const OWN = { email: 'owner@example.org', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner', idToken: 't' };
const COORD = { email: 'c1@example.org', campusId: 'ALL', roles: ['Coordinator'], primaryRole: 'Coordinator', idToken: 't' };
const P4 = { email: 'p4@example.org', campusId: 'LMS4', roles: ['Principal'], primaryRole: 'Principal', idToken: 't' };

// ═══ read: followCoordinators only when no head is an allowlist Coordinator, Owner response only ═══
{
  const ctx = load({ console: Object.assign(Object.create(console), { error() {}, warn() {} }), Logger: { log() {} } },
    ['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-confirm.gs', 'game-office.gs', 'game-kingdom.gs']);
  let cfgOverride = {};
  ctx.gameNow_ = () => new Date('2026-11-06T06:00:00Z');
  ctx.cqLoadCfg_ = () => Object.assign(J(ctx.gameConfigDefaults_()), cfgOverride);
  ctx.cqRead_ = () => [];
  ctx.cqView_ = (caller, def, scope) => ({ id: def.id, campus: scope.campus, ring: { done: false }, prefillDown: false });
  ctx.setupSteps_ = () => [];
  ctx.buddyDesk_ = () => ({ open: false, seenAt: null });
  ctx.daybookProgress_ = () => null;
  ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [[]] }) }), getSheets: () => [{ getDataRange: () => ({ getValues: () => ALLOW }) }] }) };
  const run = (c) => J(ctx.kingdomGet_(c, {}));
  let r = run(OWN);
  assert.deepStrictEqual(r.followHeads, []);
  assert.deepStrictEqual(r.followCoordinators, [{ id: 'c1@example.org', name: 'Coordinator One', email: 'c1@example.org' }, { id: 'c2@example.org', name: 'Coordinator Two', email: 'c2@example.org' }],
    'no heads: every allowlist Coordinator once (a role in a list counts), no Owner-only or Principal rows');
  const withHead = (heads) => { cfgOverride = { kingdom: Object.assign(J(ctx.gameConfigDefaults_().kingdom), { heads }) }; return run(OWN); };
  r = withHead([{ id: 'h1', name: 'Head', email: 'c2@example.org', functions: ['events'] }]);
  assert.strictEqual(r.followHeads.length, 1);
  assert.ok(!('followCoordinators' in r), 'a Coordinator head exists: the heads list only');
  r = withHead([{ id: 'h1', name: 'Not a Coordinator', email: 'p4@example.org', functions: ['events'] }]);
  assert.strictEqual(r.followCoordinators.length, 2, 'a head who is not a Coordinator does not count');
  cfgOverride = {};
  r = run(P4);
  assert.ok(!('followCoordinators' in r) && !('followHeads' in r), 'a Principal never gets names or emails');
}

// ═══ write: kingdomsethead ═══
const store = new Map();
let lockFails = false;
function fakeSheet(rows) {
  const sh = {
    rows,
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    getRange: (row, col) => {
      const put = (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; };
      const rg = { setNumberFormat: () => rg, setValues: put, setValue: (v) => put([[v]]) };
      return rg;
    },
  };
  return sh;
}
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
const ctx = load({
  console: { log() {}, error() {}, warn() {} },
  CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, String(v)); }, remove: (k) => { store.delete(k); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_SHEET_ID' ? 'GAME_BOOK' : null) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { if (lockFails) throw new Error('lock'); }, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
}, ['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-confirm.gs', 'game-office.gs', 'game-kingdom.gs', 'game-kingdom-heads.gs']);
ctx.SpreadsheetApp = { openById: (id) => (id === vm.runInContext('GAME_ALLOWLIST_SHEET_ID', ctx) ? { getSheets: () => [fakeSheet(ALLOW)] } : book) };
ctx.gameNow_ = () => new Date('2026-11-06T06:00:00Z');
const reset = (kingdomCell) => {
  const rows = [['Key', 'Value'], ['pilotCampuses', '{}']];
  if (kingdomCell !== undefined) rows.push(['kingdom', kingdomCell]);
  book.tabs = { 'Game Config': fakeSheet(rows) };
  lockFails = false;
};
const set = (c, b) => J(ctx.kingdomSetHead_(c, b));
const cell = () => { const r = book.tabs['Game Config'].rows.filter((x) => x[0] === 'kingdom')[0]; return r ? r[1] : undefined; };
const audit = () => (book.tabs['Game Allocations'] ? book.tabs['Game Allocations'].rows.slice(1) : []);
const H = J(vm.runInContext('KINGDOM_ALLOC_HEADER', ctx)), col = (r, n) => r[H.indexOf(n)];

// refusals: nothing written to the config
for (const [who, body, code, why] of [
  [COORD, { email: 'c2@example.org' }, 'KINGDOM_NO_RIGHT', 'a Coordinator cannot make heads'],
  [P4, { email: 'c2@example.org' }, 'KINGDOM_NO_RIGHT', 'a Principal cannot make heads'],
  [null, { email: 'c2@example.org' }, 'KINGDOM_NO_RIGHT', 'no caller'],
  [OWN, { email: 'not-an-email' }, 'KINGDOM_BAD_INPUT', 'bad email'],
  [OWN, { email: 42 }, 'KINGDOM_BAD_INPUT', 'email not a string'],
  [OWN, { email: 'c2@example.org', functions: ['money'] }, 'KINGDOM_BAD_INPUT', 'unknown function'],
  [OWN, { email: 'c2@example.org', functions: 'events' }, 'KINGDOM_BAD_INPUT', 'functions not a list'],
  [OWN, { email: 'p4@example.org' }, 'KINGDOM_NOT_ELIGIBLE', 'a Principal is not a Coordinator'],
  [OWN, { email: 'owner@example.org' }, 'KINGDOM_NOT_ELIGIBLE', 'the Owner row is not a Coordinator'],
  [OWN, { email: 'stranger@example.org' }, 'KINGDOM_NOT_ELIGIBLE', 'not on the allowlist'],
]) {
  reset('{"heads":[]}');
  const r = set(who, body);
  assert.strictEqual(r.success, false, why); assert.strictEqual(r.code, code, why);
  assert.strictEqual(cell(), '{"heads":[]}', why + ': config untouched');
}
reset('{"heads":[]}');
set(OWN, { email: 'p4@example.org' });
assert.deepStrictEqual(audit().map((r) => [col(r, 'Action'), col(r, 'Result'), col(r, 'Code')]), [['kingdom_head_add', 'refused', 'KINGDOM_NOT_ELIGIBLE']], 'a refusal is audited');

// adds to an existing kingdom cell, keeps every other key, name from the allowlist
reset(JSON.stringify({ levelAt: [0, 3], heads: [{ id: 'h-x', name: 'X', email: 'x@example.org', functions: ['hr'] }] }));
let r = set(OWN, { email: ' C2@Example.org ', functions: ['events'] });
assert.strictEqual(r.success, true);
assert.deepStrictEqual(r.head, { id: 'h-c2', name: 'Coordinator Two', email: 'c2@example.org', functions: ['events'] });
let k = JSON.parse(cell());
assert.deepStrictEqual(k.levelAt, [0, 3], 'other kingdom keys kept');
assert.deepStrictEqual(k.heads.map((x) => x.email), ['x@example.org', 'c2@example.org']);
assert.deepStrictEqual(audit().map((x) => [col(x, 'Phase'), col(x, 'Result'), col(x, 'Assignee')]), [['requested', '', 'c2@example.org'], ['done', 'ok', 'c2@example.org']]);
// the parsed config now lists them as a head, and the read's follow-up picker would include them
assert.strictEqual(ctx.kingdomCfg_(ctx.cqLoadCfg_()).heads.length, 2);

// repeat (a double tap): unchanged, no second entry
r = set(OWN, { email: 'c2@example.org', functions: ['finance'] });
assert.strictEqual(r.unchanged, true); assert.strictEqual(r.head.id, 'h-c2');
assert.strictEqual(JSON.parse(cell()).heads.length, 2);

// no kingdom row yet: appended with heads only (defaults fill the rest); functions default to []
reset();
r = set(OWN, { email: 'c1@example.org' });
assert.strictEqual(r.success, true);
assert.deepStrictEqual(JSON.parse(cell()), { heads: [{ id: 'h-c1', name: 'Coordinator One', email: 'c1@example.org', functions: [] }] });
assert.strictEqual(J(ctx.kingdomCfg_(ctx.cqLoadCfg_()).campuses).length, 7, 'default campuses survive');

// id collision gets a suffix
reset(JSON.stringify({ heads: [{ id: 'h-c1', name: 'Someone', email: 'other@example.org', functions: [] }] }));
assert.strictEqual(set(OWN, { email: 'c1@example.org' }).head.id, 'h-c1-2');

// an unreadable kingdom cell is never overwritten
reset('{not json');
r = set(OWN, { email: 'c1@example.org' });
assert.strictEqual(r.code, 'KINGDOM_ERROR'); assert.strictEqual(cell(), '{not json');
reset('[1,2]');
assert.strictEqual(set(OWN, { email: 'c1@example.org' }).code, 'KINGDOM_ERROR'); assert.strictEqual(cell(), '[1,2]');

// busy lock: refused, nothing written
reset('{"heads":[]}'); lockFails = true;
assert.strictEqual(set(OWN, { email: 'c1@example.org' }).code, 'KINGDOM_BUSY'); assert.strictEqual(cell(), '{"heads":[]}');

// POST only: one doPost line, never a GET action
const gameGs = fs.readFileSync(dir + 'game.gs', 'utf8');
assert.ok(/if \(action === 'kingdomsethead'\) return gameJson_\(kingdomSetHead_\(caller, body\)\);/.test(gameGs), 'doPost line');
assert.ok(!('kingdomsethead' in ctx.GAME_MODULE_ACTIONS), 'not a GET action');

// ═══ kingdom.js: the follow card is offered with Coordinators even when there are no heads ═══
{
  const src = fs.readFileSync(__dirname + '/../../assets/game/kingdom.js', 'utf8');
  assert.ok(src.includes("action: 'kingdomsethead'"), 'openFollow can make a head');
  const card = { id: 'a1', title: 'T', campus: 'LMS1', category: 'Event / Invitation' };
  const m = /function nextAction\(d\) \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(m, 'nextAction found');
  const na = new Function('sortBases', 'nextTier', m[0] + '; return nextAction;')((b) => b, () => null);
  const D = (o) => Object.assign({ role: 'Owner', kingdom: { campuses: [] }, cards: [card], followHeads: [] }, o);
  assert.strictEqual(na(D({ followCoordinators: [{ email: 'c1@example.org' }] })).kind, 'follow', 'no heads but Coordinators: offered');
  assert.strictEqual(na(D({ followCoordinators: [] })).kind, 'done', 'nobody at all: not offered');
  assert.strictEqual(na(D({ followHeads: [{ email: 'h@x' }] })).kind, 'follow');
}
console.log('test-kingdom-heads: all passed');
