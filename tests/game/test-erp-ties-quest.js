// node tests/game/test-erp-ties-quest.js -- the ERP tie confirm quest end to end on the real engine (game-confirm.gs + game-erp.gs, the
// whole Game project): a seeded tie is unconfirmed, so it shows no student until its teacher confirms it with a section (children's faces
// rule); a correction records the section named; "Not my class" unlocks nothing; the Principal reads every state. Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const proj = JSON.parse(fs.readFileSync(dir + 'projects.json', 'utf8')).game.files.filter((f) => /^[\w-]+$/.test(f)).map((f) => f + '.gs');
const store = new Map();
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
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
const erp = { tabs: {}, getSheetByName: (n) => (erp.tabs[n] ? fakeSheet(erp.tabs[n]) : null) };
const logs = [];
const ctx = {
  console: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)), warn() {} }, Logger: { log() {} },
  CacheService: { getScriptCache: () => ({
    get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, v); }, remove: (k) => { store.delete(k); },
    getAll: (ks) => { const o = {}; ks.forEach((k) => { if (store.has(k)) o[k] = store.get(k); }); return o; }, putAll: (m) => { Object.keys(m).forEach((k) => store.set(k, m[k])); },
  }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'ERP_SHEET_LMS4' ? 'ERP4' : /^ERP_/.test(k) ? null : 'GAME_BOOK') }) },
  SpreadsheetApp: { openById: (id) => (id === 'ERP4' ? erp : book) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
};
vm.createContext(ctx);
proj.forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
const J = (x) => JSON.parse(JSON.stringify(x));
ctx.gameNow_ = () => new Date('2026-11-10T05:00:00Z');
ctx.tchCodeFor_ = (c) => c.employeeCode || '';

const reset = () => {
  store.clear(); ctx.CQ_MEMO = null; logs.length = 0;
  book.tabs = { 'Game Config': fakeSheet([['Key', 'Value'], ['setupPeriod', JSON.stringify({ ownerAssignedQuestsOnly: false })]]) };
  erp.tabs = {
    students_now: [['enroll_no', 'name', 'class', 'section', 'roll_no', 'house', 'status', 'bus', 'route', 'pickup_point', 'way'],
      ['E001', 'Test Student 1', 'VII - A', 'A', '1', '', 'Active', '', '', '', ''], ['E002', 'Test Student 2', 'VII - A', 'A', '2', '', 'Active', '', '', '', ''],
      ['E003', 'Test Student 3', 'VII - B', 'B', '1', '', 'Active', '', '', '', '']],
    assignments: [['emp_code', 'kind', 'class', 'section', 'subject', 'bus', 'teacher', 'fix'],
      ['TST/99/01/001', 'class', 'VII', 'A', '', '', 'Test Teacher A', ''], ['TST/99/01/001', 'subject', 'VII', 'A', 'MATHS', '', 'Test Teacher A', ''],
      ['TST/99/01/002', 'subject', 'VII', 'A', 'HINDI', '', 'Test Teacher B', ''], ['', 'subject', 'VII', '', 'ENGLISH', '', 'Test Teacher C', 'class has 2 sections: set the section']],
  };
};
const mk = (o) => Object.assign({ email: 'teacher-a@test.invalid', campusId: 'LMS4', roles: ['Teacher'], employeeCode: 'TST/99/01/001' }, o || {});
const TA = mk(), TB = mk({ email: 'teacher-b@test.invalid', employeeCode: 'TST/99/01/002' });
const P4 = mk({ email: 'p4@test.invalid', roles: ['Principal'], employeeCode: '' });
const get = (c) => J(ctx.cqGetAction_(c, { quest: 't2' }));
const save = (c, p) => J(ctx.cqSaveAction_(c, Object.assign({ quest: 't2' }, p)));
const students = (c) => J(ctx.GAME_MODULE_ACTIONS.erpread(c, { what: 'students' }));
const faces = (r) => JSON.stringify(r).match(/Test Student|E00\d/g) || [];
const tests = [];
const test = (n, fn) => tests.push([n, fn]);

test('the quest is registered for teachers only', () => {
  reset();
  const def = ctx.cqDefs_({}).filter((d) => d.id === 't2')[0];
  assert.ok(def, 't2 is a live setup quest');
  assert.deepStrictEqual([def.scope, def.selfOnly, def.addable, def.prefill, def.skipLabel], ['self', true, false, 'erp.myTies', 'Not my class']);
  assert.deepStrictEqual(J(def.roles), ['Teacher']);
  assert.strictEqual(J(ctx.cqGetAction_(P4, { quest: 't2' })).code, 'SETUP_NOT_YOURS');
  // the Game Config override still wins over a module's quest: t2 can be switched off without a deploy
  assert.ok(!ctx.cqDefs_({ confirmQuests: { t2: { active: false } } }).some((d) => d.id === 't2'));
  assert.strictEqual(ctx.cqDefs_({ confirmQuests: { t2: { title: 'Check your classes' } } }).filter((d) => d.id === 't2')[0].title, 'Check your classes');
});

test('pre-filled from the seeded ties, nothing confirmed, no student shown', () => {
  reset();
  const q = get(TA).quests[0];
  assert.deepStrictEqual(q.items.map((i) => [i.fields.class.value, i.fields.section.value, i.fields.subject.value, i.fields.section.status]),
    [['VII', 'A', 'Class teacher', 'known'], ['VII', 'A', 'MATHS', 'known']]);
  const r = students(TA);
  assert.strictEqual(r.code, 'ERP_NOT_ALLOWED');
  assert.deepStrictEqual(faces(r), [], 'an unconfirmed tie returns no student names');
  assert.deepStrictEqual(J(ctx.GAME_MODULE_ACTIONS.erpread(TA, { what: 'scope' })).ties, []);
});

test('confirm as is: the seeded section unlocks', () => {
  reset();
  const item = get(TA).quests[0].items[0].item;
  assert.strictEqual(save(TA, { item }).success, true);
  assert.deepStrictEqual(students(TA).rows.map((s) => s.enrollNo), ['E001', 'E002']);
});

test('correct: the section the teacher names is the one that unlocks', () => {
  reset();
  const item = get(TA).quests[0].items[0].item;
  assert.strictEqual(save(TA, { item, fields: { section: 'B' } }).success, true);
  assert.deepStrictEqual(students(TA).rows.map((s) => s.enrollNo), ['E003']);
});

test('a blank section or a changed class unlocks nothing', () => {
  reset();
  const item = get(TA).quests[0].items[0].item;
  assert.strictEqual(save(TA, { item, fields: { section: '' } }).code, 'SETUP_FIELD_REQUIRED');
  assert.strictEqual(save(TA, { item, fields: { class: 'VIII' } }).success, true);
  assert.strictEqual(students(TA).code, 'ERP_NOT_ALLOWED');
});

test('Not my class unlocks nothing; one teacher never confirms another', () => {
  reset();
  const item = get(TA).quests[0].items[0].item;
  assert.strictEqual(save(TA, { item, skip: true }).success, true);
  assert.strictEqual(students(TA).code, 'ERP_NOT_ALLOWED');
  assert.strictEqual(save(TB, { item }).code, 'SETUP_BAD_ITEM', "another teacher's item is not in their quest");
  assert.strictEqual(save(TA, { item: 'e_tst_99_01_002-s-vii-a-hindi' }).code, 'SETUP_BAD_ITEM');
});

test("the Principal's review: every state, staff only, counts-only logs", () => {
  reset();
  const items = get(TA).quests[0].items;
  save(TA, { item: items[0].item });
  save(TA, { item: items[1].item, fields: { section: 'B' } });
  const r = J(ctx.GAME_MODULE_ACTIONS.erpread(P4, { what: 'ties' }));
  assert.deepStrictEqual(r.rows.map((x) => [x.teacher, x.subject, x.state, x.section]),
    [['Test Teacher A', '', 'confirmed', 'A'], ['Test Teacher A', 'MATHS', 'corrected', 'B'], ['Test Teacher B', 'HINDI', 'pending', ''], ['Test Teacher C', 'ENGLISH', 'fix', '']]);
  assert.deepStrictEqual(r.summary, { pending: 1, confirmed: 1, corrected: 1, notmine: 0, fix: 1 });
  assert.deepStrictEqual(faces(r), []);
  assert.strictEqual(J(ctx.GAME_MODULE_ACTIONS.erpread(TA, { what: 'ties' })).code, 'ERP_NOT_ALLOWED');
  logs.filter((l) => /^erpread/.test(l)).forEach((l) => assert.ok(/^erpread \w+ (LMS\d|all) rows=\d+$/.test(l), 'log shape: ' + l));
});

let failed = 0;
tests.forEach(([n, fn]) => { try { fn(); console.log('ok   ' + n); } catch (e) { failed++; console.log('FAIL ' + n + '\n' + e.message); } });
if (failed) process.exit(1);
console.log('test-erp-ties-quest: all passed');
