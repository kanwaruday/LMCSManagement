// node tests/game/test-confirm.js -- setup quest engine: store and actions (game-confirm.gs)
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const store = new Map(), events = [];
let lockFails = false;
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
function fakeSheet(rows) {
  const sh = {
    rows, appendRow: (r) => { sh.rows.push(r.slice()); },
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    getRange: (row, col, nr, nc) => {
      const rg = { setNumberFormat: () => rg, setValues: (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; } };
      return rg;
    },
  };
  return sh;
}
const ctx = {
  console: { log() {}, error() {} },
  CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, v); }, remove: (k) => { store.delete(k); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'GAME_BOOK' }) },
  SpreadsheetApp: { openById: () => book },
  LockService: { getScriptLock: () => ({ waitLock: () => { if (lockFails) throw new Error('lock'); events.push('lock'); }, releaseLock: () => events.push('unlock') }) },
};
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-confirm.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs');
ctx.questGateKeep_ = () => null; // the setup-period gate (game-kingdom.gs) is off here: tests/game/test-quest-gate.js covers it
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-11-10T05:00:00Z');
ctx.gameNow_ = () => NOW;
ctx.cqDefaults_ = () => ({}); // own definitions here; the shipped ones are in test-confirm-t1.js
const f = (id, type, extra) => Object.assign({ id, label: id, type, required: true }, extra || {});
const DEFS = {
  tq: { title: 'T', scope: 'self', roles: ['Teacher'], fields: [f('class', 'text'), f('subject', 'text')], addable: true, emptyLabel: 'None', skipLabel: 'Skip', prefill: 'test.rows' },
  cq2: { title: 'C', scope: 'campus', roles: ['Principal'], fields: [f('period', 'number'), f('start', 'time')] },
  nq: { title: 'N', scope: 'network', roles: ['Principal'], fields: [f('name', 'text')] },
  sq: { title: 'S', scope: 'self', selfOnly: true, roles: ['Teacher', 'Owner'], fields: [f('phone', 'text')], sample: [{ item: 's1', fields: { phone: '98xxx' } }] },
};
const reset = (defs) => {
  book.tabs = { 'Game Config': fakeSheet([['Key', 'Value'], ['confirmQuests', JSON.stringify(defs || DEFS)]]) };
  events.length = 0; lockFails = false; ctx.CQ_MEMO = null; adapterCalls = 0; readCalls = 0;
  ctx.CQ_PREFILL['test.rows'] = () => { adapterCalls++; return [{ item: 'a', fields: { class: 'Class 7', subject: 'Math' } }, { item: 'b', fields: { class: 'Class 8', subject: 'Sci' } }]; };
};
let adapterCalls = 0, readCalls = 0;
const origRead = ctx.cqRead_;
ctx.cqRead_ = () => { readCalls++; return origRead(); };
const mk = (o) => Object.assign({ email: 'Teacher-A@test.invalid', campusId: 'LMS4', roles: ['Teacher'] }, o || {});
const TA = mk(), TB = mk({ email: 'b@test.invalid' });
const PR = mk({ email: 'p@test.invalid', roles: ['Principal'] });
const OWN = mk({ email: 'o@test.invalid', roles: ['Owner', 'Principal'], campusId: 'ALL' });
const get = (c, p) => J(ctx.cqGetAction_(c, p || {}));
const save = (c, p) => J(ctx.cqSaveAction_(c, p));
const dataRows = () => (book.tabs['Setup Data'] ? book.tabs['Setup Data'].rows.slice(1) : []);
const tests = [];
const test = (n, fn) => tests.push([n, fn]);

test('cqValidDef_ rejects bad definitions', () => {
  const ok = { title: 'X', scope: 'self', roles: ['Teacher'], fields: [f('class', 'text')] };
  const v = (o, id) => J(ctx.cqValidDef_(id || 'x1', Object.assign({}, ok, o)));
  assert.strictEqual(v({}, 'Bad Id'), null);
  assert.strictEqual(v({ scope: 'school' }), null);
  assert.strictEqual(v({ roles: [] }), null);
  assert.strictEqual(v({ fields: [f('_x', 'text')] }), null);
  assert.strictEqual(v({ fields: [f('a', 'text'), f('a', 'text')] }), null);
  assert.strictEqual(v({ fields: [f('a', 'money')] }), null);
  assert.strictEqual(v({ fields: [f('a', 'choice')] }), null);
  assert.strictEqual(v({ selfOnly: true, scope: 'campus' }), null);
  assert.strictEqual(v({ scope: 'campus', campuses: ['LMS9'] }), null);
  const d = v({});
  assert.strictEqual(d.task, 'X'); assert.strictEqual(d.itemTitle, '{class}'); assert.strictEqual(d.active, true);
  assert.deepStrictEqual(d.campuses, ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']);
});
test('config merges over defaults and active:false hides', () => {
  const saved = ctx.cqDefaults_;
  ctx.cqDefaults_ = () => ({ tq: DEFS.tq });
  const ids = (a) => J(a.map((d) => d.id));
  assert.deepStrictEqual(ids(ctx.cqDefs_({ confirmQuests: { tq: { active: false }, nq: DEFS.nq } })), ['nq']);
  assert.deepStrictEqual(ids(ctx.cqDefs_({ confirmQuests: { tq: { active: false } } }, true)), ['tq']);
  assert.deepStrictEqual(ids(ctx.cqDefs_({ confirmQuests: { nq: DEFS.nq } })), ['tq', 'nq']);
  ctx.cqDefaults_ = saved;
});
test('cqValue_ per type', () => {
  const v = (type, x, extra) => ctx.cqValue_(Object.assign({ id: 'z', type }, extra || {}), x);
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } };
  assert.strictEqual(v('time', '9:05'), '09:05');
  assert.strictEqual(code(() => v('time', '24:00')), 'SETUP_BAD_VALUE');
  assert.strictEqual(v('number', '012'), '12');
  assert.strictEqual(code(() => v('text', 'A/c 123456789')), 'SETUP_NUMBER_REFUSED');
  assert.strictEqual(code(() => v('choice', 'z', { choices: ['a'] })), 'SETUP_BAD_VALUE');
  assert.strictEqual(code(() => v('date', '2026-02-30')), 'SETUP_BAD_VALUE');
  assert.strictEqual(v('date', '2026-02-28'), '2026-02-28');
  assert.strictEqual(v('yesno', 'yes'), 'yes');
  assert.strictEqual(v('text', null), '');
});
test('merge: known, then stored wins, latest row wins', () => {
  reset();
  const def = ctx.cqValidDef_('tq', DEFS.tq);
  const known = { items: [{ item: 'a', fields: { class: 'Class 7', subject: '' } }, { item: 'b', fields: { class: 'C8', subject: 'S' } }], down: false };
  const rows = [['tq', 'self:x', 'a', 'class', 'First', 'confirmed'], ['tq', 'self:x', 'a', 'class', 'Second', 'confirmed'], ['tq', 'self:x', 'n-1', 'class', 'New', 'confirmed']]
    .map((r) => ({ quest: r[0], scope: r[1], item: r[2], field: r[3], value: r[4], status: r[5], note: '', at: '' }));
  const m = J(ctx.cqMerge_(def, known, ctx.cqStored_(rows, 'tq', 'self:x')));
  assert.deepStrictEqual(m.map((i) => i.item), ['a', 'b', 'n-1']);
  assert.strictEqual(m[0].fields.class.value, 'Second'); assert.strictEqual(m[0].fields.class.status, 'confirmed');
  assert.strictEqual(m[0].fields.subject, undefined);
  assert.strictEqual(m[1].fields.class.status, 'known');
});
test('counts: required only, skipped counts, empty is not done', () => {
  const def = ctx.cqValidDef_('q', { title: 'q', scope: 'self', roles: ['Teacher'], fields: [f('a', 'text'), f('b', 'text', { required: false })] });
  const c = (s) => ({ fields: { a: { value: 'x', status: s }, b: { value: 'y', status: 'known' } } });
  assert.deepStrictEqual(J(ctx.cqCount_(def, [c('confirmed'), c('skipped'), c('known')])), { confirmed: 2, known: 1, total: 3, done: false });
  assert.strictEqual(ctx.cqCount_(def, [c('confirmed'), c('skipped')]).done, true);
  assert.strictEqual(ctx.cqCount_(def, []).done, false);
});
test('setupget scopes', () => {
  reset();
  assert.deepStrictEqual(get(TA).quests.map((q) => q.id), ['tq', 'sq']);
  assert.strictEqual(get(TA, { quest: 'cq2' }).code, 'SETUP_NOT_YOURS');
  const p = get(PR).quests;
  assert.deepStrictEqual(p.map((q) => q.id + ':' + q.campus), ['cq2:LMS4', 'nq:null']);
  assert.strictEqual(get(PR, { quest: 'cq2', campus: 'LMS2' }).code, 'SETUP_BAD_CAMPUS');
  const o = get(OWN).quests.filter((q) => q.id === 'cq2');
  assert.deepStrictEqual(o.map((q) => q.campus), ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']);
  assert.strictEqual(get(TA, { viewAsCode: 'TST/99/01/002' }).code, 'SETUP_NO_VIEW_AS');
});
test('setupsave confirm writes rows under the lock', () => {
  reset();
  const r = save(TA, { quest: 'tq', item: 'a', fields: { class: 'Class 7' } });
  assert.strictEqual(r.success, true, JSON.stringify(r));
  assert.deepStrictEqual(book.tabs['Setup Data'].rows[0], ['Quest', 'Scope', 'Item', 'Field', 'Value', 'Status', 'Note', 'At', 'By']);
  const rows = dataRows();
  assert.deepStrictEqual(rows.map((x) => x[3] + '=' + x[4] + ':' + x[5]), ['class=Class 7:confirmed', 'subject=Math:confirmed']);
  assert.strictEqual(rows[0][8], 'teacher-a@test.invalid'); assert.strictEqual(rows[0][1], 'self:teacher-a@test.invalid');
  assert.deepStrictEqual(events, ['lock', 'unlock']);
  assert.strictEqual(r.ring.confirmed, 2); assert.strictEqual(r.itemsDone, 1); assert.strictEqual(r.saved.item, 'a');
});
test('setupsave refusals write nothing', () => {
  reset();
  const code = (c, p) => save(c, p).error;
  assert.strictEqual(code(TA, { quest: 'tq', item: 'new', fields: { class: 'C' } }), 'SETUP_FIELD_REQUIRED: subject');
  assert.strictEqual(code(TA, { quest: 'tq', item: 'a', fields: { grade: '1' } }), 'SETUP_UNKNOWN_FIELD: grade');
  reset(Object.assign({}, DEFS, { tq: Object.assign({}, DEFS.tq, { addable: false }) }));
  assert.strictEqual(code(TA, { quest: 'tq', item: 'new', fields: { class: 'C', subject: 'S' } }), 'SETUP_BAD_ITEM');
  assert.strictEqual(code(TA, { quest: 'tq', item: 'zzz', skip: true }), 'SETUP_BAD_ITEM');
  reset(Object.assign({}, DEFS, { tq: Object.assign({}, DEFS.tq, { emptyLabel: '' }) }));
  assert.strictEqual(code(TA, { quest: 'tq', item: '_none', skip: true }), 'SETUP_NO_NONE');
  assert.strictEqual(code(TA, { quest: 'tq', item: 'a', sample: true }), 'SETUP_SAMPLE_READ_ONLY');
  assert.strictEqual(dataRows().length, 0);
});
test('_none makes an empty quest done', () => {
  reset();
  ctx.CQ_PREFILL['test.rows'] = () => [];
  const r = save(TA, { quest: 'tq', item: '_none', skip: true });
  assert.strictEqual(r.success, true, JSON.stringify(r));
  assert.strictEqual(r.ring.done, true); assert.strictEqual(r.itemsTotal, 0);
});
test('self rows are per person', () => {
  reset();
  save(TA, { quest: 'tq', item: 'a', fields: { class: 'Class 7' }, email: 'b@test.invalid' });
  assert.strictEqual(dataRows()[0][1], 'self:teacher-a@test.invalid');
  const a = get(TB, { quest: 'tq' }).quests[0].items.filter((i) => i.item === 'a')[0];
  assert.strictEqual(a.fields.class.status, 'known');
});
test('selfOnly refuses identity params before reading', () => {
  reset();
  assert.strictEqual(get(TA, { quest: 'sq', email: 'x' }).code, 'SETUP_SELF_ONLY');
  assert.strictEqual(save(TA, { quest: 'sq', code: 'x', item: 'a', fields: { phone: 'p' } }).code, 'SETUP_SELF_ONLY');
  assert.strictEqual(readCalls, 0); assert.strictEqual(dataRows().length, 0);
});
test('sample view', () => {
  reset(Object.assign({}, DEFS, { cq2: Object.assign({}, DEFS.cq2, { active: false, roles: ['Teacher'] }) }));
  save(OWN, { quest: 'sq', item: 's1', fields: { phone: 'real' } });
  readCalls = 0; adapterCalls = 0;
  const r = get(OWN, { sample: '1', role: 'Teacher' });
  assert.strictEqual(r.sample, true);
  assert.deepStrictEqual(r.quests.map((q) => q.id), ['tq', 'cq2', 'sq']);
  assert.strictEqual(r.quests.filter((q) => q.id === 'sq')[0].items[0].fields.phone.value, '98xxx');
  assert.strictEqual(r.quests.filter((q) => q.id === 'cq2')[0].draft, true);
  assert.strictEqual(readCalls, 0); assert.strictEqual(adapterCalls, 0);
  assert.strictEqual(get(TA, { sample: '1', role: 'Teacher' }).code, 'SETUP_SAMPLE_OWNER_ONLY');
});
test('lock timeout is SETUP_BUSY', () => {
  reset(); lockFails = true;
  assert.strictEqual(save(TA, { quest: 'tq', item: 'a', fields: { class: 'C' } }).code, 'SETUP_BUSY');
  assert.strictEqual(dataRows().length, 0);
});
test('missing adapter is prefillDown', () => {
  reset(Object.assign({}, DEFS, { tq: Object.assign({}, DEFS.tq, { prefill: 'nope' }) }));
  save(TA, { quest: 'tq', item: 'mine', fields: { class: 'C', subject: 'S' } });
  const q = get(TA, { quest: 'tq' }).quests[0];
  assert.strictEqual(q.prefillDown, true); assert.deepStrictEqual(q.items.map((i) => i.item), ['mine']);
});
test('memo', () => {
  reset();
  ctx.cqStatus_(TA, ctx.cqLoadCfg_(), NOW, {}); ctx.cqStatus_(TA, ctx.cqLoadCfg_(), NOW, {});
  assert.strictEqual(adapterCalls, 1);
  save(TA, { quest: 'tq', item: 'a', fields: { class: 'C' } });
  assert.strictEqual(ctx.CQ_MEMO, null);
});

test('adapter values pass the value guard on confirm-as-is', () => {
  reset();
  ctx.CQ_PREFILL['test.rows'] = () => [{ item: 'a', fields: { class: 'Class 7', subject: '9876543210' } }];
  const r = save(TA, { quest: 'tq', item: 'a', fields: { class: 'Class 7' } });
  assert.strictEqual(r.success, false); assert.strictEqual(r.error, 'SETUP_BAD_VALUE: subject');
  assert.strictEqual(dataRows().length, 0);
});
test('a non-coded error returns a fixed message', () => {
  reset();
  ctx.cqRead_ = () => { throw new TypeError('secret detail'); };
  const r = save(TA, { quest: 'tq', item: 'a', fields: { class: 'C' } });
  ctx.cqRead_ = () => { readCalls++; return origRead(); };
  assert.strictEqual(r.code, 'SETUP_ERROR'); assert.strictEqual(r.error, 'Something went wrong. Try again.');
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 4).join('\n  ')); } }
if (fail) process.exit(1);
