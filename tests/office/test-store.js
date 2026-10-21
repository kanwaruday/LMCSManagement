// Store layer (apps-script/office-store.gs): tables, idempotent append, audit.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const caller = { email: 'clerk1@example.org' };
const entry = (id, extra) => Object.assign({ id, campus: 'LMS1', entry_date: '2026-10-21', direction: 'in', amount_paise: 12345 }, extra);

module.exports = function run(t) {
  const fresh = () => { const h = boot(); h.addBook('LMS1', '2026-27'); h.addBook('LMS2', '2026-27'); return h; };
  const open = (h, c) => h.ctx.officeOpen_(c || 'LMS1', '2026-27');
  const rows = (h, ss, tab) => h.ctx.officeRows_(ss, tab);

  t.test('append writes one row and one audit row', () => {
    const h = fresh(); const ss = open(h);
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    const r = h.ctx.officeAppend_(ss, 'DayBook', entry('a1'), caller, { action: 'daybook.add' });
    assert.deepEqual(JSON.parse(JSON.stringify(r)), { id: 'a1', duplicate: false });
    const d = rows(h, ss, 'DayBook'); const a = rows(h, ss, 'Audit');
    assert.equal(d.length, 1); assert.equal(a.length, 1);
    assert.equal(d[0].created_by, 'clerk1@example.org');
    assert.equal(d[0].created_at, '2026-10-21T10:00:00.000Z');
    assert.equal(a[0].action, 'daybook.add'); assert.equal(a[0].tab, 'DayBook'); assert.equal(a[0].row_id, 'a1');
    assert.equal(a[0].who, 'clerk1@example.org'); assert.equal(a[0].campus, 'LMS1');
    assert.equal(JSON.parse(a[0].after).amount_paise, 12345);
  });

  t.test('same id twice writes once, second returns duplicate:true', () => {
    const h = fresh(); const ss = open(h);
    h.ctx.officeAppend_(ss, 'DayBook', entry('a1'), caller, { action: 'x' });
    const r = h.ctx.officeAppend_(ss, 'DayBook', entry('a1', { amount_paise: 999 }), caller, { action: 'x' });
    assert.equal(r.duplicate, true);
    assert.equal(rows(h, ss, 'DayBook').length, 1);
    assert.equal(rows(h, ss, 'DayBook')[0].amount_paise, 12345);
    assert.equal(rows(h, ss, 'Audit').length, 1, 'duplicate is not audited');
  });

  t.test('two appends in sequence keep header intact and order', () => {
    const h = fresh(); const ss = open(h);
    h.ctx.officeAppend_(ss, 'DayBook', entry('a1'), caller, {});
    h.ctx.officeAppend_(ss, 'DayBook', entry('a2'), caller, {});
    assert.deepEqual(rows(h, ss, 'DayBook').map((r) => r.id), ['a1', 'a2']);
    assert.deepEqual(Array.from(ss.getSheetByName('DayBook').values[0]), Array.from(h.ctx.OFFICE_TABLES.DayBook));
    open(h); // reopening never rewrites or duplicates headers/rows
    assert.equal(ss.getSheetByName('DayBook').values.length, 3);
  });

  t.test('missing book property throws NO_BOOK', () => {
    const h = fresh();
    assert.throws(() => h.ctx.officeOpen_('LMS3', '2026-27'), /NO_BOOK/);
    assert.throws(() => h.ctx.officeConfig_(), /NO_BOOK/);
  });

  t.test('append without id throws MISSING_ID', () => {
    const h = fresh();
    assert.throws(() => h.ctx.officeAppend_(open(h), 'DayBook', { campus: 'LMS1' }, caller, {}), /MISSING_ID/);
  });

  t.test('rows from two campuses never mix', () => {
    const h = fresh();
    h.ctx.officeAppend_(open(h, 'LMS1'), 'DayBook', entry('a1'), caller, {});
    h.ctx.officeAppend_(open(h, 'LMS2'), 'DayBook', entry('b1', { campus: 'LMS2' }), caller, {});
    assert.deepEqual(rows(h, open(h, 'LMS1'), 'DayBook').map((r) => r.id), ['a1']);
    assert.deepEqual(rows(h, open(h, 'LMS2'), 'DayBook').map((r) => r.id), ['b1']);
  });

  t.test('every table gets its tab with header row', () => {
    const h = fresh(); const ss = open(h);
    Object.keys(h.ctx.OFFICE_TABLES).forEach((tab) => assert.deepEqual(Array.from(ss.getSheetByName(tab).values[0]), Array.from(h.ctx.OFFICE_TABLES[tab]), tab));
  });

  t.test('ISO dates and "=" text read back as the identical strings', () => {
    const h = fresh(); const ss = open(h);
    h.ctx.officeAppend_(ss, 'DayBook', entry('a1', { narration: '=SUM(1)', payee: '007' }), caller, {});
    const r = rows(h, ss, 'DayBook')[0];
    assert.strictEqual(r.entry_date, '2026-10-21');
    assert.strictEqual(r.narration, '=SUM(1)');
    assert.strictEqual(r.payee, '007');
    assert.match(r.created_at, /^2\d{3}-\d\d-\d\dT/);
    assert.strictEqual(typeof ss.getSheetByName('DayBook').values[1][2], 'string', 'stored as text, not Date');
  });

  t.test('amount_paise reads back as a Number, late as boolean', () => {
    const h = fresh(); const ss = open(h);
    h.ctx.officeAppend_(ss, 'DayBook', entry('a1'), caller, {});
    h.ctx.officeAppend_(ss, 'Reports', { id: 'r1', campus: 'LMS1', report_date: '2026-10-21', late: true }, caller, {});
    assert.strictEqual(rows(h, ss, 'DayBook')[0].amount_paise, 12345);
    assert.strictEqual(rows(h, ss, 'Reports')[0].late, true);
  });

  t.test('fake proves the risk: a range without @ coerces', () => {
    const h = fresh(); const sh = open(h).getSheetByName('DayBook');
    sh.getRange(5, 1, 1, 3).setValues([['2026-10-21', '=SUM(1)', '12']]);
    const v = sh.values[4];
    assert.ok(v[0] instanceof Date); assert.ok(v[1].formula); assert.strictEqual(v[2], 12);
  });
};
