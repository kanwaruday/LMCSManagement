// Legacy day book importer (tools/office-import-daybook.mjs) and officeImportRows_ (apps-script/office-import.gs).
// Fake data only. Needs Node >= 22.12 (require of an ES module).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot } = require('./harness');
const imp = require('../../tools/office-import-daybook.mjs');

const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'daybook-legacy-sample.csv'), 'utf8');
const mapping = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'office-import-mapping.example.json'), 'utf8'));
const AT = '2026-10-21T00:00:00.000Z';
const build = (m) => imp.buildImport(csv, m || mapping, 'LMS1', AT);

module.exports = function run(t) {
  t.test('rows map to paise exactly', () => {
    const r = build().rows;
    assert.deepStrictEqual(r.map((x) => x.amount_paise), [1250050, 30000, 100000, 15000000, 10, 25000]);
    assert.deepStrictEqual(r.map((x) => [x.direction, x.mode, x.bucket, x.category]), [
      ['IN', 'cash', 'fee', 'fee_collection'], ['OUT', 'cash', 'petty', 'petty_expense'], ['IN', 'upi', '', 'fee_collection'],
      ['OUT', 'bank', '', 'bill_payment'], ['IN', 'cash', 'fee', 'other_in'], ['IN', 'cash', 'fee', 'donation']]);
    assert.strictEqual(r[5].narration, 'Note with, comma and "quote"');
  });

  t.test('signed single amount column: negative is a payment', () => {
    const m = Object.assign({}, mapping, { amount: { signed: 'Receipt' } });
    const row = { Date: '2026-04-01', Receipt: '-1,234.50', Mode: 'cash', Head: 'petty' };
    const x = imp.mapLegacyRow(row, Object.assign({}, m, { dateFormat: 'YYYY-MM-DD' }), { campus: 'LMS1', rowNumber: 2 });
    assert.deepStrictEqual([x.direction, x.amount_paise, x.category], ['OUT', 123450, 'other_out']);
  });

  t.test('unparseable rows are skipped with a reason, never guessed', () => {
    const b = build();
    assert.deepStrictEqual(b.skipped.map((s) => s.rowNumber), [7, 8, 9, 10, 11, 12]);
    assert.deepStrictEqual(b.skipped.map((s) => s.reason.split(' ')[0]), ['unparseable', 'unreadable', 'unmapped', 'both', 'zero', 'unparseable']);
    assert.ok(b.report.includes('row 7: unparseable amount "abc"'));
    assert.strictEqual(b.rows.length, 6);
    const noDefault = imp.mapLegacyRow({ Date: '01/04/2026', Receipt: '5', Mode: 'Cash', Head: 'Nope' }, Object.assign({}, mapping, { bucket: { column: 'Head', map: {} } }), { campus: 'LMS1', rowNumber: 2 });
    assert.ok(noDefault.skip && /bucket/.test(noDefault.reason));
  });

  t.test('totals per day match the legacy totals; a wrong legacy total is reported', () => {
    const b = build();
    assert.strictEqual(b.diffs.length, 0);
    assert.deepStrictEqual(imp.verifyTotals(b.rows, { '2026-04-01': 12200 * 100 + 50 }), { ok: true, diffs: [] });
    const bad = imp.verifyTotals(b.rows, { '2026-04-01': 1220000 });
    assert.deepStrictEqual(bad, { ok: false, diffs: [{ date: '2026-04-01', legacy: 1220000, computed: 1220050, diff: 50 }] });
    const rep = imp.buildImport(csv.replace('"12,200.50"', '"12,200.00"'), mapping, 'LMS1', AT);
    assert.ok(rep.report.includes('2026-04-01: legacy 12200.00, computed 12200.50, diff 0.50'));
  });

  t.test('re-running yields identical ids and output; ids are campus-scoped hashes of the row number', () => {
    const a = build(), b = build();
    assert.strictEqual(a.daybook, b.daybook);
    assert.strictEqual(a.closes, b.closes);
    assert.ok(a.rows.every((r) => /^imp-LMS1-[0-9a-f]{16}$/.test(r.id)));
    assert.strictEqual(new Set(a.rows.map((r) => r.id)).size, 6);
    assert.notStrictEqual(imp.buildImport(csv, mapping, 'LMS2', AT).rows[0].id.slice(8), a.rows[0].id.slice(8));
    assert.deepStrictEqual(imp.parseCsv(a.closes)[1].slice(0, 3), ['impclose-LMS1-2026-04-01', 'LMS1', '2026-04-01']);
  });

  t.test('output columns follow OFFICE_TABLES and closing_json is the backend balances shape', () => {
    const h = boot(); const b = build();
    const cols = (n) => JSON.parse(JSON.stringify(h.ctx.OFFICE_TABLES[n]));
    assert.deepStrictEqual(imp.parseCsv(b.daybook)[0], cols('DayBook'));
    assert.deepStrictEqual(imp.parseCsv(b.closes)[0], cols('Closes'));
    const last = JSON.parse(imp.parseCsv(b.closes)[3][3]);
    assert.strictEqual(last.closing.cash.fee, 1250050 + 10 + 25000);
    assert.strictEqual(imp.parseCsv(b.daybook)[1][12] + imp.parseCsv(b.daybook)[1][13], AT + 'import');
  });

  t.test('officeImportRows_ appends once, idempotently, and imported days read as closed', () => {
    const h = boot(); h.addConfig(); const book = h.addBook('LMS1', '2026-27'); h.setNow(new Date('2026-10-21T10:00:00Z'));
    const b = build();
    const r1 = h.ctx.officeImportRows_('LMS1', '2026-27', 'DayBook', b.daybook);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r1)), { tab: 'DayBook', rows: 6, appended: 6, duplicates: 0, otherFy: 0 });
    const r2 = h.ctx.officeImportRows_('LMS1', '2026-27', 'DayBook', b.daybook);
    assert.deepStrictEqual([r2.appended, r2.duplicates], [0, 6]);
    assert.strictEqual(h.ctx.officeImportRows_('LMS1', '2026-27', 'Closes', b.closes).appended, 3);
    assert.strictEqual(h.locks.acquired, 3); assert.strictEqual(h.locks.released, 3);
    const rows = h.ctx.officeRows_(book, 'DayBook');
    assert.strictEqual(rows.length, 6); assert.strictEqual(rows[0].amount_paise, 1250050); assert.strictEqual(rows[0].created_by, 'import');
    assert.strictEqual(h.ctx.officeIsClosed_(book, '2026-04-02'), true);
    assert.strictEqual(h.call('daybook.add', { id: 'x', campus: 'LMS1', entry_date: '2026-04-02', direction: 'IN', mode: 'upi', category: 'fee_collection', amount_paise: 100 }).code, 'DAY_CLOSED');
    assert.strictEqual(JSON.stringify(h.call('daybook.balances', { campus: 'LMS1', date: '2026-04-03' }).closing.cash.fee), String(1250050 + 10 + 25000));
  });

  t.test('officeImportRows_ refuses other tabs, bad headers, other campuses, and skips other-year rows', () => {
    const h = boot(); h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26'); h.setNow(new Date('2026-10-21T10:00:00Z'));
    const b = build();
    for (const tab of ['Audit', 'Opening', 'Reopens', 'Nope']) assert.throws(() => h.ctx.officeImportRows_('LMS1', '2026-27', tab, b.daybook), /BAD_TAB/);
    assert.throws(() => h.ctx.officeImportRows_('LMS1', '2026-27', 'DayBook', b.closes), /BAD_HEADER/);
    assert.throws(() => h.ctx.officeImportRows_('LMS2', '2026-27', 'DayBook', b.daybook), /WRONG_CAMPUS/);
    assert.strictEqual(h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'DayBook').length, 0, 'nothing written by refused imports');
    const prev = h.ctx.officeImportRows_('LMS1', '2025-26', 'DayBook', b.daybook);
    assert.deepStrictEqual([prev.appended, prev.otherFy], [0, 6]);
  });
};
