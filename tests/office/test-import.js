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
    assert.deepStrictEqual(b.skipped.map((s) => s.rowNumber), [7, 8, 9, 10, 11, 12, 14, 15]);
    assert.deepStrictEqual(b.skipped.map((s) => s.reason.split(' ')[0]), ['unparseable', 'unreadable', 'unmapped', 'both', 'zero', 'unparseable', 'negative', 'negative']);
    assert.ok(b.report.includes('row 7: unparseable amount "abc"'));
    assert.strictEqual(b.rows.length, 6);
    const noDefault = imp.mapLegacyRow({ Date: '01/04/2026', Receipt: '5', Mode: 'Cash', Head: 'Nope' }, Object.assign({}, mapping, { bucket: { column: 'Head', map: {} } }), { campus: 'LMS1', rowNumber: 2 });
    assert.ok(noDefault.skip && /bucket/.test(noDefault.reason));
  });

  t.test('days with a skipped row are not closed; they are listed, and undated skips warn that totals are partial', () => {
    const b = build();
    assert.deepStrictEqual(b.heldOpen, ['2026-04-03']);
    assert.deepStrictEqual(imp.parseCsv(b.closes).slice(1).map((r) => r[2]), ['2026-04-01', '2026-04-02']);
    assert.strictEqual(b.rows.length, 6, 'the rows themselves are still imported');
    assert.ok(b.report.includes('Days left open') && b.report.includes('  2026-04-03'));
    assert.ok(b.report.includes('totals are partial'), 'row 8 has no readable date');
    const dated = imp.buildImport(csv.split('\n').filter((l) => !l.startsWith('31/02')).join('\n'), mapping, 'LMS1', AT);
    assert.ok(!dated.report.includes('totals are partial'));
  });

  t.test('negative receipt or payment is skipped, not sign-dropped', () => {
    const m = (row) => imp.mapLegacyRow(Object.assign({ Date: '01/04/2026', Mode: 'Cash', Head: 'Fees' }, row), mapping, { campus: 'LMS1', rowNumber: 2 });
    assert.strictEqual(m({ Receipt: '-300' }).reason, 'negative amount in receipt/payment column');
    assert.strictEqual(m({ Payment: '-300' }).reason, 'negative amount in receipt/payment column');
    assert.strictEqual(m({ Payment: '300' }).direction, 'OUT');
  });

  t.test('a leading BOM does not corrupt the first header', () => {
    assert.deepStrictEqual(imp.parseCsv('\uFEFFDate,Receipt\n1,2')[0], ['Date', 'Receipt']);
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
    const cols = (n) => JSON.parse(JSON.stringify(h.ctx.OFFICE_TABLES[n])).slice(0, JSON.parse(JSON.stringify(h.ctx.OFFICE_TABLES[n])).indexOf('created_by') + 1); // the importer emits the original columns
    assert.deepStrictEqual(imp.parseCsv(b.daybook)[0], cols('DayBook'));
    assert.deepStrictEqual(imp.parseCsv(b.closes)[0], cols('Closes'));
    const last = JSON.parse(imp.parseCsv(b.closes)[2][3]);
    assert.strictEqual(last.closing.cash.fee, 1250050 + 10);
    assert.strictEqual(imp.parseCsv(b.daybook)[1][12] + imp.parseCsv(b.daybook)[1][13], AT + 'import');
  });

  t.test('officeImportRows_ appends once, idempotently, and imported days read as closed', () => {
    const h = boot(); h.addConfig(); const book = h.addBook('LMS1', '2026-27'); h.setNow(new Date('2026-10-21T10:00:00Z'));
    const b = build();
    assert.throws(() => h.ctx.officeImportRows_('LMS1', '2026-27', 'DayBook', b.daybook), /OPENING_FIRST/, 'opening must be loaded first');
    assert.strictEqual(h.ctx.officeImportRows_('LMS1', '2026-27', 'Opening', b.openings['2026-27']).appended, 5);
    const r1 = h.ctx.officeImportRows_('LMS1', '2026-27', 'DayBook', b.daybook);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r1)), { tab: 'DayBook', rows: 6, appended: 6, duplicates: 0, otherFy: 0 });
    const r2 = h.ctx.officeImportRows_('LMS1', '2026-27', 'DayBook', b.daybook);
    assert.deepStrictEqual([r2.appended, r2.duplicates], [0, 6]);
    assert.strictEqual(h.ctx.officeImportRows_('LMS1', '2026-27', 'Closes', b.closes).appended, 2);
    assert.strictEqual(h.locks.acquired, 4); assert.strictEqual(h.locks.released, 4);
    const rows = h.ctx.officeRows_(book, 'DayBook');
    assert.strictEqual(rows.length, 6); assert.strictEqual(rows[0].amount_paise, 1250050); assert.strictEqual(rows[0].created_by, 'import');
    assert.strictEqual(h.ctx.officeIsClosed_(book, '2026-04-02'), true);
    assert.strictEqual(h.call('daybook.add', { id: 'x', campus: 'LMS1', entry_date: '2026-04-02', direction: 'IN', mode: 'upi', category: 'fee_collection', amount_paise: 100 }).code, 'DAY_CLOSED');
    assert.strictEqual(JSON.stringify(h.call('daybook.balances', { campus: 'LMS1', date: '2026-04-03' }).closing.cash.fee), String(1250050 + 10 + 25000));
  });

  t.test('officeImportRows_ refuses other tabs, bad headers, other campuses, and skips other-year rows', () => {
    const h = boot(); h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26'); h.setNow(new Date('2026-10-21T10:00:00Z'));
    const b = build();
    for (const tab of ['Audit', 'Reopens', 'Nope']) assert.throws(() => h.ctx.officeImportRows_('LMS1', '2026-27', tab, b.daybook), /BAD_TAB/);
    assert.throws(() => h.ctx.officeImportRows_('LMS1', '2026-27', 'DayBook', b.closes), /BAD_HEADER/);
    assert.throws(() => h.ctx.officeImportRows_('LMS2', '2026-27', 'DayBook', b.daybook), /WRONG_CAMPUS/);
    assert.strictEqual(h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'DayBook').length, 0, 'nothing written by refused imports');
    h.ctx.officeImportRows_('LMS1', '2025-26', 'Opening', b.openings['2026-27']);
    const prev = h.ctx.officeImportRows_('LMS1', '2025-26', 'DayBook', b.daybook);
    assert.deepStrictEqual([prev.appended, prev.otherFy], [0, 6]);
  });
  // I5 / R39: opening balances per financial year, carried forward from the import's own 31 March closing.
  const MULTI = ['Date,Receipt,Payment,Mode,Head,Category,Party,Narration,Closing Balance',
    '30/03/2026,1000,,Cash,Fees,Fees,A,x,', '31/03/2026,,200,Bank,,Bills,B,y,', '01/04/2026,50,,UPI,,Fees,C,z,', '02/04/2026,5,,Cash,Fees,Nope,D,w,'].join('\n') + '\n';
  const withOpening = Object.assign({}, mapping, { opening: { cash: { petty: 0, fee: 100, other: 0 }, bank: 5000, upi: 0 } });

  t.test('importer writes opening-<fy>.csv per year; later years carry the previous 31 March closing', () => {
    const b = imp.buildImport(MULTI, withOpening, 'LMS1', AT);
    assert.deepStrictEqual(Object.keys(b.openings), ['2025-26', '2026-27']);
    const amounts = (fy) => imp.parseCsv(b.openings[fy]).slice(1).map((r) => [r[2], r[3], r[4]].join(':'));
    const h = boot();
    assert.deepStrictEqual(imp.parseCsv(b.openings['2025-26'])[0], JSON.parse(JSON.stringify(h.ctx.OFFICE_TABLES.Opening)).slice(0, 7));
    assert.deepStrictEqual(amounts('2025-26'), ['cash:petty:0', 'cash:fee:100', 'cash:other:0', 'bank::5000', 'upi::0']);
    assert.deepStrictEqual(amounts('2026-27'), ['cash:petty:0', 'cash:fee:100100', 'cash:other:0', 'bank::-15000', 'upi::0']);
    assert.ok(b.report.includes('Load order') && b.report.indexOf('opening-2025-26.csv') < b.report.indexOf('opening-2026-27.csv'));
    assert.strictEqual(b.defaulted, 1);
    assert.ok(b.report.includes('Category defaulted to other_in/other_out: 1 row'), 'M6 counts defaulted categories');
  });

  t.test('loading opening then day book per year gives the same closings as the import computed', () => {
    const h = boot(); h.addConfig(); h.addBook('LMS1', '2025-26'); h.addBook('LMS1', '2026-27'); h.setNow(new Date('2026-10-21T10:00:00Z'));
    const b = imp.buildImport(MULTI, withOpening, 'LMS1', AT);
    for (const fy of ['2025-26', '2026-27']) {
      h.ctx.officeImportRows_('LMS1', fy, 'Opening', b.openings[fy]);
      h.ctx.officeImportRows_('LMS1', fy, 'DayBook', b.daybook);
      h.ctx.officeImportRows_('LMS1', fy, 'Closes', b.closes);
    }
    const bal = (d) => JSON.parse(JSON.stringify(h.call('daybook.balances', { campus: 'LMS1', date: d }).closing));
    const closes = imp.parseCsv(b.closes).slice(1);
    for (const c of closes) assert.deepStrictEqual(bal(c[2]), JSON.parse(c[3]).closing, c[2]);
    assert.strictEqual(bal('2026-04-02').cash.fee, 100100 + 500);
    assert.strictEqual(h.ctx.officeImportRows_('LMS1', '2026-27', 'Opening', b.openings['2026-27']).duplicates, 5, 're-run is safe');
    const other = b.openings['2026-27'].replace(/impopen-LMS1-2026-27-bank/, 'impopen-LMS1-2026-27-bank2');
    assert.throws(() => h.ctx.officeImportRows_('LMS1', '2026-27', 'Opening', other), /OPENING_LOCKED/, 'no new opening under existing day book rows');
  });
};
