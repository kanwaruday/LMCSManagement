// node tests/game/test-confirm-t1.js -- setup quest engine: T1 end to end and the CampusSetup drafts, real cqDefaults_(). Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const proj = JSON.parse(fs.readFileSync(dir + 'projects.json', 'utf8')).game.files.filter((f) => /^[\w-]+$/.test(f)).map((f) => f + '.gs');
const store = new Map();
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
const ctx = {
  console: { log() {}, error() {} }, Logger: { log() {} },
  CacheService: { getScriptCache: () => ({
    get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, v); }, remove: (k) => { store.delete(k); },
    getAll: (ks) => { const o = {}; ks.forEach((k) => { if (store.has(k)) o[k] = store.get(k); }); return o; }, putAll: (m) => { Object.keys(m).forEach((k) => store.set(k, m[k])); },
  }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'GAME_BOOK' }) },
  SpreadsheetApp: { openById: () => book },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
};
vm.createContext(ctx);
proj.forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-11-10T05:00:00Z');
ctx.gameNow_ = () => NOW;
ctx.tchCodeFor_ = (c) => c.employeeCode || '';
const ROSTER = { success: true, rows: [
  { employeeCode: 'TST/99/01/001', class: 'Class 7', subject: 'Math' }, { employeeCode: 'TST/99/01/001', class: 'Class 8', subject: 'Science' },
  { employeeCode: 'TST/99/01/002', class: 'Class 3', subject: 'Hindi' },
] };
const TT = { campusPeriodSchedule: { LMS4: [{ period: 1, start: '9:20', end: '10:00' }, { period: 2, start: '10:00', end: '10:35' }] }, campuses: { LMS4: {} } };
ctx.UrlFetchApp = { fetch: (url) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(/action=roster/.test(url) ? ROSTER : TT) }) };
const reset = (cfg) => {
  store.clear(); ctx.CQ_MEMO = null;
  book.tabs = { 'Game Config': fakeSheet([['Key', 'Value'], ['setupPeriod', JSON.stringify({ ownerAssignedQuestsOnly: false })]].concat(cfg ? [['confirmQuests', JSON.stringify(cfg)]] : [])) };
};
const mk = (o) => Object.assign({ email: 'teacher-a@test.invalid', campusId: 'LMS4', roles: ['Teacher'], employeeCode: 'TST/99/01/001' }, o || {});
const TA = mk(), NONE = mk({ email: 'none@test.invalid', employeeCode: 'TST/99/01/777' });
const pr = (campusId, email) => mk({ email, campusId, roles: ['Principal'], employeeCode: '' });
const P4 = pr('LMS4', 'p4@test.invalid'), P2 = pr('LMS2', 'p2@test.invalid');
const OWN = mk({ email: 'o@test.invalid', roles: ['Owner'], campusId: 'ALL' });
const get = (c, p) => J(ctx.cqGetAction_(c, p || {}));
const save = (c, p) => J(ctx.cqSaveAction_(c, p));
const mission = (c) => J(ctx.cqMissions_(c, ctx.cqLoadCfg_(), NOW)).filter((m) => m.id === 'cq_t1:me')[0];
const tests = [];
const test = (n, fn) => tests.push([n, fn]);

test('defaults validate', () => {
  const cfg = { confirmQuests: {} };
  assert.deepStrictEqual(J(ctx.cqDefs_(cfg, true).map((d) => d.id)), ['t1', 'p1', 'p2', 'p3']);
  assert.deepStrictEqual(J(ctx.cqDefs_(cfg).map((d) => d.id)), ['t1']);
  assert.strictEqual(ctx.cqDefs_(cfg)[0].fields[0].hint, 'As on the timetable, like Class 7');
});
test('T1 walk-through', () => {
  reset();
  const g = get(TA, { quest: 't1' }).quests[0];
  assert.deepStrictEqual(g.items.map((i) => i.item), ['c-class7-math', 'c-class8-science']);
  assert.ok(g.items.every((i) => Object.keys(i.fields).every((k) => i.fields[k].status === 'known')));
  assert.deepStrictEqual(g.ring, { confirmed: 0, known: 4, total: 4, done: false });
  let m = mission(TA);
  assert.deepStrictEqual([m.progress, m.title], [{ done: 0, total: 2 }, 'Check the classes you teach']);
  assert.deepStrictEqual(save(TA, { quest: 't1', item: 'c-class7-math' }).ring, { confirmed: 2, known: 2, total: 4, done: false });
  const r = save(TA, { quest: 't1', item: 'c-class8-science', skip: true });
  assert.strictEqual(r.ring.done, true);
  ctx.CQ_MEMO = null; m = mission(TA);
  assert.strictEqual(m.done, true);
  assert.strictEqual(J(ctx.cqQuests_(TA, ctx.cqLoadCfg_(), NOW, {})).filter((q) => q.questId === 'cq:t1')[0].complete, true);
  const n = save(TA, { quest: 't1', item: 'n-abc', fields: { class: 'Class 9', subject: 'Art & Craft' } });
  assert.strictEqual(n.itemsTotal, 3); assert.strictEqual(n.ring.done, true);
});
test('T1 for a teacher with no classes', () => {
  reset();
  let m = mission(NONE);
  assert.ok(m && m.progress === undefined && m.done === false);
  assert.strictEqual(save(NONE, { quest: 't1', item: '_none', skip: true }).ring.done, true);
  ctx.CQ_MEMO = null;
  assert.strictEqual(mission(NONE).done, true);
});
test('T1 writes only Setup Data, never the Employee Master', () => {
  reset(); save(TA, { quest: 't1', item: 'c-class7-math' });
  assert.deepStrictEqual(Object.keys(book.tabs).sort(), ['Game Config', 'Setup Data']);
  assert.ok(!/EmpMaster|EmpAcademic/.test(fs.readFileSync(dir + 'game-confirm.gs', 'utf8')));
});
test('CampusSetup drafts work when switched on', () => {
  reset({ p2: { active: true }, p3: { active: true } });
  const q = get(P4).quests;
  assert.deepStrictEqual(q.map((x) => x.id), ['p2', 'p3']);
  const bells = q.filter((x) => x.id === 'p2')[0];
  assert.deepStrictEqual(bells.items.map((i) => i.item), ['p1', 'p2']);
  assert.ok(bells.items.every((i) => i.fields.start.status === 'known'));
  assert.strictEqual(save(P4, { quest: 'p3', item: 'n-red', fields: { name: 'Red House', colour: 'Red' } }).success, true);
  const h = get(P2, { quest: 'p3' }).quests[0];
  assert.strictEqual(h.items[0].fields.name.value, 'Red House'); assert.strictEqual(h.items[0].fields.name.status, 'confirmed');
  assert.deepStrictEqual(get(TA).quests.map((x) => x.id), ['t1']);
});
test('sample view for the review', () => {
  reset();
  const p = get(OWN, { sample: '1', role: 'Principal' });
  assert.deepStrictEqual(p.quests.map((q) => q.id), ['p1', 'p2', 'p3']);
  assert.ok(p.quests.every((q) => q.draft === true && q.items.length > 0));
  const t = get(OWN, { sample: '1', role: 'Teacher' }).quests;
  assert.deepStrictEqual(t.map((q) => [q.id, q.draft]), [['t1', false]]);
});
let bad = 0;
tests.forEach(([n, fn]) => { try { fn(); console.log('ok   ' + n); } catch (e) { bad++; console.log('FAIL ' + n + '\n' + (e.stack || e)); } });
process.exit(bad ? 1 : 0);
