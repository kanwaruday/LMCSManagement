// node tests/game/test-confirm-view.js -- setup quest engine: the client's pure helpers (assets/setup/confirm-values.js). Synthetic data.
'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const C = await import('../../assets/setup/confirm-values.js');
  const ok = (n) => console.log('  ok  - ' + n);
  const F = (id, type, extra) => Object.assign({ id, label: id, type, required: true }, extra || {});
  const quest = { id: 't1', scope: 'self', campus: null, fields: [F('class', 'text'), F('subject', 'text'), F('room', 'text', { required: false })], items: [], itemTitle: '{class} · {subject}' };
  const item = (o) => ({ item: o.k, fields: o.f });
  const known = item({ k: 'a', f: { class: { value: 'Class 7', status: 'known' }, subject: { value: 'Math', status: 'known' } } });

  assert.strictEqual(C.fillTitle('{class} · {subject}', known), 'Class 7 · Math');
  assert.strictEqual(C.fillTitle('{class} · {subject}', null), '·', 'server rule: literal text survives');
  assert.strictEqual(C.fillTitle('{class}', null), 'New entry');
  assert.strictEqual(C.fillTitle('{class}', item({ k: 'x', f: { class: { value: '', status: 'skipped' } } })), 'New entry'); ok('fillTitle');

  const skipped = item({ k: 's', f: { class: { value: '', status: 'skipped' }, subject: { value: '', status: 'skipped' } } });
  const m = C.itemModel(quest, known);
  assert.ok(m[0].known && m[1].known && !m[2].known && m[0].value === 'Class 7');
  assert.ok(C.itemModel(quest, item({ k: 'c', f: { class: { value: 'X', status: 'confirmed' } } }))[0].known === false);
  assert.ok(C.itemModel(quest, skipped).every((f) => f.value === '' && !f.known)); ok('itemModel');

  const mt = C.itemModel(quest, null);
  assert.deepStrictEqual(C.savePayload(quest, 'k', { class: 'Class 7', subject: '' }, mt), { ok: false, code: 'SETUP_FIELD_REQUIRED', field: 'subject' });
  assert.strictEqual(C.savePayload(quest, 'k', { class: '123456789', subject: 'Math' }, mt).code, 'SETUP_NUMBER_REFUSED');
  const tq = { id: 'tt', scope: 'campus', campus: 'LMS4', fields: [F('start', 'time'), F('n', 'number'), F('d', 'date'), F('c', 'choice', { choices: ['a', 'b'] })], items: [] };
  const tm = C.itemModel(tq, null), good = { start: '9:05', n: '12', d: '2026-11-10', c: 'a' };
  assert.strictEqual(C.savePayload(tq, 'k', { ...good, start: '9:5' }, tm).code, 'SETUP_BAD_VALUE');
  assert.strictEqual(C.savePayload(tq, 'k', { ...good, n: '1234567' }, tm).field, 'n');
  assert.strictEqual(C.savePayload(tq, 'k', { ...good, c: 'z' }, tm).field, 'c');
  const p = C.savePayload(tq, 'k', good, tm);
  assert.ok(p.ok && p.data.campus === 'LMS4' && p.data.quest === 'tt' && p.data.item === 'k');
  const p2 = C.savePayload(quest, 'k', { class: 'Class 7', subject: 'Math' }, mt);
  assert.ok(p2.ok && !('campus' in p2.data) && !('room' in p2.data));
  const cleared = C.savePayload(quest, 'a', { class: 'C', subject: 'M', room: '' }, C.itemModel(quest, item({ k: 'a', f: { class: { value: 'C', status: 'known' }, subject: { value: 'M', status: 'known' }, room: { value: '3', status: 'confirmed' } } })));
  assert.strictEqual(cleared.data.fields.room, ''); ok('savePayload');

  const mixed = item({ k: 'm', f: { class: { value: 'Class 8', status: 'confirmed' }, subject: { value: 'Sci', status: 'known' } } });
  const q1 = { ...quest, items: [known, mixed], ring: { confirmed: 1, known: 3, total: 4, done: false } };
  const wait = (data, seq) => ({ action: 'setupsave', status: 'waiting', seq, data });
  const a = C.applyQueued(q1, [wait({ quest: 't1', item: 'a', fields: {} }, 1)]);
  assert.ok(a.items[0].fields.class.status === 'confirmed' && a.items[0].fields.class.pending && a.items[0].fields.subject.status === 'confirmed');
  assert.deepStrictEqual([a.ring.confirmed, a.ring.known, a.ring.total], [3, 1, 4]);
  assert.strictEqual(a.itemsDone, 1); assert.strictEqual(q1.items[0].fields.class.status, 'known', 'input untouched');
  const s2 = C.applyQueued(q1, [wait({ quest: 't1', item: 'a', skip: true }, 1)]);
  assert.ok(Object.values(s2.items[0].fields).every((c) => c.status === 'skipped' && c.pending));
  const other = C.applyQueued(q1, [wait({ quest: 'zz', item: 'a', fields: {} }, 1), { action: 'setupsave', status: 'attention', seq: 2, data: { quest: 't1', item: 'a', fields: {} } }]);
  assert.deepStrictEqual(other.ring, q1.ring);
  const nw = C.applyQueued(q1, [wait({ quest: 't1', item: 'n-1', fields: { class: 'C9', subject: 'Art' } }, 1)]);
  assert.strictEqual(nw.items.length, 3); assert.strictEqual(nw.itemsTotal, 3); assert.strictEqual(nw.ring.total, 6);
  const camp = { ...tq, items: [], ring: { confirmed: 0, known: 0, total: 0 } };
  assert.strictEqual(C.applyQueued(camp, [wait({ quest: 'tt', campus: 'LMS1', item: 'z', fields: good }, 1)]).items.length, 0, 'other campus ignored');
  assert.strictEqual(C.applyQueued(camp, [wait({ quest: 'tt', campus: 'LMS4', item: 'z', fields: good }, 1)]).items.length, 1); ok('applyQueued');

  const src = fs.readFileSync(__dirname + '/../../apps-script/game-confirm.gs', 'utf8'), ctx = { console };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  [known, mixed, skipped].forEach((it) => {
    const s = JSON.parse(JSON.stringify(ctx.cqCount_(quest, [it]))), c = C.itemCounts(quest, it);
    assert.deepStrictEqual(c, { confirmed: s.confirmed, known: s.known, total: s.total });
  }); ok('itemCounts equals the server cqCount_');

  assert.deepStrictEqual(C.parseLink('?quest=t1&campus=lms4&item=c-x'), { quest: 't1', campus: 'LMS4', item: 'c-x', sample: false, role: null });
  assert.deepStrictEqual(C.parseLink('?quest=T1;&campus=LMS9'), { quest: null, campus: null, item: null, sample: false, role: null });
  assert.deepStrictEqual(C.parseLink('?sample=1&role=Teacher'), { quest: null, campus: null, item: null, sample: true, role: 'Teacher' });
  assert.ok(/^n-[0-9a-z]+$/.test(C.newItemKey(Date.now()))); ok('parseLink');

  const codes = [...new Set(src.match(/'SETUP_[A-Z_]+'/g))].map((s) => s.slice(1, -1));
  assert.ok(codes.length > 10);
  codes.forEach((c) => assert.ok(C.CODES[c], 'CODES missing ' + c)); ok('CODES covers every server code');

  const page = fs.readFileSync(__dirname + '/../../setup/index.html', 'utf8');
  const url = /GAME_BACKEND_URL = '([^']+)'/.exec(fs.readFileSync(__dirname + '/../../office/js/config.js', 'utf8'))[1];
  assert.ok(page.includes(url) && page.includes("only: 'cq'") && page.includes('tour:'));
  assert.ok(/PAGES = \[[^\]]*'setup\/index\.html'/.test(fs.readFileSync(__dirname + '/../../tools/stamp-assets.mjs', 'utf8'))); ok('the page is wired');
  console.log('confirm-view: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
