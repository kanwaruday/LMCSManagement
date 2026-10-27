// node tests/game/test-confirm-buddy.js -- setup quest engine: Buddy missions and quests through the module hooks (game-confirm.gs)
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const proj = JSON.parse(fs.readFileSync(dir + 'projects.json', 'utf8')).game.files.filter((f) => /^[\w-]+$/.test(f)).map((f) => f + '.gs');
const store = new Map(), events = [];
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
function fakeSheet(rows) {
  const sh = {
    rows, appendRow: (r) => { sh.rows.push(r.slice()); },
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    getRange: (row, col) => {
      const rg = { setNumberFormat: () => rg, setValues: (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; } };
      return rg;
    },
  };
  return sh;
}
function mkCtx(files) {
  const c = {
    console: { log() {}, error() {} },
    CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, v); }, remove: (k) => { store.delete(k); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'GAME_BOOK' }) },
    SpreadsheetApp: { openById: () => book },
    LockService: { getScriptLock: () => ({ waitLock: () => events.push('lock'), releaseLock: () => events.push('unlock') }) },
  };
  vm.createContext(c);
  files.forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), c));
  return c;
}
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-11-10T05:00:00Z');
const ctx = mkCtx(proj);
ctx.gameNow_ = () => NOW;
const f = (id, type, extra) => Object.assign({ id, label: id, type, required: true }, extra || {});
const DEFS = {
  tq: { title: 'T', task: 'Confirm your classes', scope: 'self', roles: ['Teacher'], fields: [f('class', 'text'), f('subject', 'text')], itemTitle: '{class} {subject}', addable: true, emptyLabel: 'None', prefill: 'test.rows' },
  cq2: { title: 'C', scope: 'campus', roles: ['Principal'], fields: [f('period', 'number'), f('start', 'time')], prefill: 'test.rows' },
};
let CUR = DEFS;
const CFG = () => ({ confirmQuests: CUR });
let adapterCalls = 0, adapterOpts = null, nItems = 2;
const reset = (defs) => {
  CUR = defs || DEFS;
  book.tabs = { 'Game Config': fakeSheet([['Key', 'Value'], ['confirmQuests', JSON.stringify(defs || DEFS)]]) };
  events.length = 0; ctx.CQ_MEMO = null; adapterCalls = 0; adapterOpts = null; nItems = 2; store.clear();
  ctx.CQ_PREFILL['test.rows'] = (c, opts) => {
    adapterCalls++; adapterOpts = opts;
    const out = [];
    for (let i = 0; i < nItems; i++) out.push({ item: String.fromCharCode(97 + i), fields: { class: 'Class ' + (i + 1), subject: 'Math' } });
    return out;
  };
};
const mk = (o) => Object.assign({ email: 'teacher-a@test.invalid', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher' }, o || {});
const TA = mk(), PR = mk({ email: 'p@test.invalid', roles: ['Principal'], primaryRole: 'Principal' });
const tests = [];
const test = (n, fn) => tests.push([n, fn]);
const hasName = (c, reg, role, name) => c.gameModuleHooks_(c[reg], role).some((h) => h.name === name);

test('hooks survive either load order', () => {
  [proj.slice().sort(), proj.slice().sort().reverse()].forEach((order) => {
    const c = mkCtx(order);
    assert.ok(hasName(c, 'GAME_MODULE_MISSIONS', 'Teacher', 'tchMissionsHook_') && hasName(c, 'GAME_MODULE_MISSIONS', 'Teacher', 'cqMissions_'), order[0]);
    assert.ok(hasName(c, 'GAME_MODULE_QUESTS', 'Teacher', 'tchQuestsHook_') && hasName(c, 'GAME_MODULE_QUESTS', 'Teacher', 'cqQuests_'), order[0]);
    assert.ok(hasName(c, 'GAME_MODULE_MISSIONS', 'Staff', 'tchStaffMissionsHook_') && hasName(c, 'GAME_MODULE_MISSIONS', 'Staff', 'cqMissions_'), order[0]);
    c.CQ_HOOK_ROLES.forEach((r) => assert.ok(hasName(c, 'GAME_MODULE_MISSIONS', r, 'cqMissions_') && hasName(c, 'GAME_MODULE_QUESTS', r, 'cqQuests_'), r));
  });
});
test('mission shape', () => {
  reset();
  book.tabs['Setup Data'] = fakeSheet([ctx.CQ_HEADER, ['tq', 'self:teacher-a@test.invalid', 'a', 'class', 'Class 1', 'confirmed'], ['tq', 'self:teacher-a@test.invalid', 'a', 'subject', 'Math', 'confirmed']]);
  const m = J(ctx.cqMissions_(TA, CFG(), NOW));
  assert.strictEqual(m.length, 1);
  assert.deepStrictEqual([m[0].id, m[0].kind, m[0].title, m[0].done, m[0].shared, m[0].core, m[0].go], ['cq_tq:me', 'cq_tq', 'Confirm your classes', false, false, false, 'setup/index.html?quest=tq']);
  assert.deepStrictEqual(m[0].progress, { done: 1, total: 2 });
  ctx.CQ_MEMO = null;
  book.tabs['Setup Data'].rows.push(['tq', 'self:teacher-a@test.invalid', 'b', 'class', 'Class 2', 'confirmed'], ['tq', 'self:teacher-a@test.invalid', 'b', 'subject', 'Math', 'confirmed']);
  assert.strictEqual(J(ctx.cqMissions_(TA, CFG(), NOW))[0].done, true);
  const p = J(ctx.cqMissions_(PR, CFG(), NOW))[0];
  assert.deepStrictEqual([p.id, p.shared, p.go, p.campus], ['cq_cq2:LMS4', true, 'setup/index.html?quest=cq2&campus=LMS4', 'LMS4']);
});
test('empty quests', () => {
  reset(); nItems = 0;
  const m = J(ctx.cqMissions_(TA, CFG(), NOW));
  assert.strictEqual(m.length, 1); assert.strictEqual(m[0].progress, undefined); assert.strictEqual(m[0].done, false);
  reset({ tq: Object.assign({}, DEFS.tq, { emptyLabel: '' }) }); nItems = 0;
  assert.deepStrictEqual(J(ctx.cqMissions_(TA, CFG(), NOW)), []);
});
test('quest shape', () => {
  reset();
  const q = J(ctx.cqQuests_(TA, CFG(), NOW, {}))[0];
  assert.deepStrictEqual([q.questId, q.parallel, q.complete], ['cq:tq', true, false]);
  assert.deepStrictEqual(q.steps.map((s) => s.id), ['a', 'b']);
  assert.ok(q.steps[0].go.endsWith('&item=a'));
  assert.deepStrictEqual(q.steps.map((s) => s.title), ['Class 1 Math', 'Class 2 Math']);
  reset(); nItems = 15;
  const big = J(ctx.cqQuests_(TA, CFG(), NOW, {}))[0].steps;
  assert.strictEqual(big.length, 12); assert.strictEqual(big[11].id, '_more'); assert.strictEqual(big[11].title, '+4 more');
  reset(); book.tabs['Setup Data'] = fakeSheet([ctx.CQ_HEADER, ['tq', 'self:teacher-a@test.invalid', '_none', 'class', '', 'skipped']]);
  assert.ok(!J(ctx.cqQuests_(TA, CFG(), NOW, {}))[0].steps.some((s) => s.id === '_none'));
  reset({ tq: Object.assign({}, DEFS.tq, { prefill: '' }) });
  const st = J(ctx.cqQuests_(TA, CFG(), NOW, {}))[0].steps;
  assert.deepStrictEqual(st.map((s) => [s.id, s.title]), [['start', 'Confirm your classes']]);
});
test('memo and cache-only', () => {
  reset();
  ctx.cqMissions_(TA, CFG(), NOW); ctx.cqQuests_(TA, CFG(), NOW, {});
  assert.strictEqual(adapterCalls, 1);
  ctx.cqQuests_(TA, CFG(), new Date(NOW.getTime() + 1000), CFG());
  assert.strictEqual(adapterCalls, 2); assert.strictEqual(adapterOpts.cacheOnly, true);
});
test('a failing source never breaks Today', () => {
  reset();
  ctx.CQ_PREFILL['test.rows'] = () => { throw new Error('down'); };
  assert.doesNotThrow(() => ctx.cqMissions_(TA, CFG(), NOW));
  reset();
  const orig = ctx.cqRead_;
  ctx.cqRead_ = () => { throw new Error('book down'); };
  try { assert.deepStrictEqual(J(ctx.cqMissions_(TA, CFG(), NOW)), []); ctx.CQ_MEMO = null; assert.deepStrictEqual(J(ctx.cqQuests_(TA, CFG(), NOW, {})), []); } finally { ctx.cqRead_ = orig; }
});
test('hooks never write', () => {
  reset();
  ctx.cqMissions_(TA, CFG(), NOW); ctx.cqQuests_(TA, CFG(), NOW, { peek: true });
  assert.strictEqual(book.tabs['Setup Data'], undefined);
  assert.ok(!events.includes('lock'));
});
test('gameToday_ end to end', () => {
  [undefined, '1'].forEach((peek) => {
    reset();
    ['Game Daily', 'Game Progress', 'Game Quests', 'Game Windows', 'Game Decisions'].forEach((n) => { book.tabs[n] = fakeSheet([['h']]); });
    book.tabs['Game Daily'] = fakeSheet([['Day', 'Email', 'Role', 'Campus', 'MissionIds', 'DoneIds', 'Finalized', 'OnTrack', 'CreatedAt', 'CoreIds']]);
    book.tabs['Game Progress'] = fakeSheet([['Email', 'Kind', 'Key', 'Value', 'At']]);
    ctx.gameLoadSources_ = () => ({ src: {}, down: [] });
    const r = J(ctx.gameToday_(TA, peek ? { peek } : {}));
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.ok(r.missions.some((m) => m.id === 'cq_tq:me'), 'mission ' + peek);
    assert.ok(r.quests.some((q) => q.questId === 'cq:tq'), 'quest ' + peek);
  });
});

let failed = 0;
tests.forEach(([n, fn]) => { try { fn(); console.log('ok  ' + n); } catch (e) { failed++; console.log('FAIL ' + n + '\n' + (e.stack || e)); } });
process.exit(failed ? 1 : 0);
