// Sheet importer (tools/office-import-sheet.mjs) and officeImportFromDrive (apps-script/office-import.gs). Fake data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');
const imp = require('../../tools/office-import-sheet.mjs');
const { parseCsv } = require('../../tools/office-import-daybook.mjs');

const AT = '2026-10-22T00:00:00.000Z';
const OPTS = { from: '2026-04-01', to: '2026-10-22', at: AT };
const H = 'Timestamp,Date,Type of Transaction,Bill/ Receipt No./ Details,Category,Other Category,School,Particulars,Amount,Email Address';
const line = (d, type, cat, amount, o = {}) => ['', d, type, o.bill || '', cat, o.other || '', o.school === undefined ? '' : o.school, o.part || 'p', '"' + amount + '"', ''].join(',');
const LMS1 = [H,
  line('01/04/2026', 'Received', 'Fee Received', '1,000.50'),                        // 2
  line('02/04/2026', 'Paid', 'Bank Deposit', '400'),                                  // 3 contra
  line('03/04/2026', 'Piad', 'Salary', '50', { part: 'ADVANCE for A' }),              // 4 typo, advance
  line('03/04/2026', 'Paid', 'Salary', '60'),                                         // 5 wages
  line('04/04/2026', 'Paid', 'Personal', '10', { school: 'LMS 3' }),                  // 6 chairman
  line('05/04/2026', 'Paid', 'Not on this List', '20', { part: 'fill diesel' }),      // 7 review proposal fuel
  line('05/04/2026', 'Paid', 'Not on this List', '30'),                               // 8 review corrected
  line('05/04/2026', 'Paid', 'Not on this List', '40'),                               // 9 not in review
  line('06/04/2026', 'Received', 'Activity at School', '70', { part: 'Field trip fee' }), // 10 IN
  line('06/04/2026', 'Paid', 'Mystery', '5', { school: 'HES', bill: '--' }),          // 11 unknown
  line('31/03/2026', 'Paid', 'Internet', '5'),                                        // 12 out of range
  line('', 'Paid', 'Internet', '5'),                                                  // 13 undated
  line('07/04/2026', 'Swap', 'Internet', '5'),                                        // 14 bad type
  line('07/04/2026', 'Paid', 'Internet', '0'),                                        // 15 zero
  line('07/04/2026', 'Paid', 'Internet', 'abc'),                                      // 16 bad
  line('08/04/2026', 'Received', 'Office Stationary', '15', { bill: 'B-7' }),         // 17 direction mismatch
].join('\n') + '\n';
const REVIEW = 'Campus,Sheet row,Details,Proposed category,Your correction\nLMS1,7,x,fuel,\nLMS 1,8,x,fuel,stationery\n';
const build = (sheets = { LMS1 }, actual = { LMS1: 1000 }) => imp.buildImport(sheets, REVIEW, actual, OPTS);
const rowOf = (b, n) => b.campuses.LMS1.rows.find((r) => r.id === b.campuses.LMS1.ids[n]);

module.exports = function run(t) {
  const b = build();
  const rows = b.campuses.LMS1.rows;
  t.test('direction, paise, account, source, columns', () => {
    const r = rowOf(b, 2);
    assert.deepStrictEqual([r.direction, r.amount_paise, r.account, r.mode, r.source, r.created_by, r.category, r.mapped_by, r.charged_to], ['IN', 100050, 'cash:LMS1', 'cash', 'sheet', 'import', 'fee_collection', 'rule', 'LMS1']);
    assert.strictEqual(rowOf(b, 4).direction, 'OUT');
    const h = boot(); const cols = JSON.parse(JSON.stringify(h.ctx.OFFICE_TABLES.DayBook));
    assert.deepStrictEqual(parseCsv(b.campuses.LMS1.daybook)[0], cols.concat(cols.includes('collection') ? [] : ['collection']));
  });
  t.test('skipped rows are listed with reasons and never imported', () => {
    for (const [n, why] of [[12, 'outside'], [13, 'undated'], [14, 'unreadable type'], [15, 'amount'], [16, 'amount']]) assert.ok(b.report.includes(`row ${n}: `) && new RegExp(`row ${n}: .*${why}`).test(b.report), String(n));
    assert.ok(b.report.includes('skipped: 5'));
  });
  t.test('contra deposit writes cash out and a paired bank in', () => {
    const o = rowOf(b, 3), k = rows.find((r) => r.id === o.id + '-bank');
    assert.deepStrictEqual([o.category, o.account, o.direction], ['deposit_cash_out', 'cash:LMS1', 'OUT']);
    assert.deepStrictEqual([k.category, k.account, k.direction, k.mode, k.bucket, k.amount_paise, k.entry_date], ['deposit_bank_in', 'bank:LMS1', 'IN', 'bank', '', 40000, o.entry_date]);
  });
  t.test('salary, personal, school mapping', () => {
    assert.strictEqual(rowOf(b, 4).category, 'salary_advance'); assert.strictEqual(rowOf(b, 5).category, 'labour_wages');
    assert.deepStrictEqual([rowOf(b, 6).category, rowOf(b, 6).charged_to], ['chairman_personal', 'CHAIRMAN']);
    assert.strictEqual(rowOf(b, 11).charged_to, 'HES');
  });
  t.test('review: proposal -> transport_legacy, correction overrides, missing -> fallback', () => {
    assert.deepStrictEqual([rowOf(b, 7).category, rowOf(b, 7).mapped_by], ['transport_legacy', 'review']);
    assert.deepStrictEqual([rowOf(b, 8).category, rowOf(b, 8).mapped_by], ['stationery', 'review-corrected']);
    assert.deepStrictEqual([rowOf(b, 9).category, rowOf(b, 9).mapped_by], ['other_out', 'fallback']);
  });
  t.test('unknown category and direction mismatch fall back with a reason; legacy_category and narration kept', () => {
    assert.deepStrictEqual([rowOf(b, 11).category, rowOf(b, 11).legacy_category], ['other_out', 'Mystery']);
    const m = rowOf(b, 17);
    assert.deepStrictEqual([m.category, m.mapped_by, m.narration], ['other_in', 'fallback', 'p (B-7)']);
    assert.ok(/row 17: stationery is OUT, row is IN/.test(b.report) || /row 17: other_out is OUT/.test(b.report));
    assert.strictEqual(rowOf(b, 11).narration, 'p', 'dash-only bill detail dropped');
  });
  t.test('collection keyword on student_collection rows', () => {
    assert.strictEqual(rowOf(b, 10).category, 'student_collection');
    assert.strictEqual(rowOf(b, 10).collection, 'field_trips');
    const c = imp.collectionOf;
    assert.deepStrictEqual(['Sof fee', 'MUN reg', 'tournament', 'Annual Function', 'xyz', 'communal'].map(c), ['olympiads', 'mun', 'sports', 'annual_function', '', '']);
  });
  t.test('adjustment brings cash closing to the counted amount (backend balances); none when equal; none without --actual', () => {
    const h = boot();
    const adj = rows.find((r) => r.id === 'sheet-LMS1-adjustment-fee');
    assert.deepStrictEqual([adj.entry_date, adj.account, adj.narration], ['2026-10-22', 'cash:LMS1', 'Sheet import adjustment to the counted cash in hand on 2026-10-22']);
    const cash = rows.filter((r) => r.account === 'cash:LMS1').map((r) => ({ ...r }));
    const c = JSON.parse(JSON.stringify(h.ctx.officeBalances_({ cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 }, cash, '2026-10-22'))).closing.cash;
    assert.strictEqual(c.petty + c.fee + c.other, 100000);
    const same = build({ LMS1 }, { LMS1: 1000 }).campuses.LMS1.rows.length;
    const exact = imp.buildImport({ LMS1 }, REVIEW, { LMS1: ((100000 - (adj.direction === 'IN' ? adj.amount_paise : -adj.amount_paise)) / 100).toFixed(2) }, OPTS);
    assert.ok(!exact.campuses.LMS1.rows.some((r) => r.id === 'sheet-LMS1-adjustment-fee'), 'zero diff, no row');
    assert.strictEqual(exact.campuses.LMS1.rows.length, same - 1);
    const none = imp.buildImport({ LMS1 }, REVIEW, {}, OPTS);
    assert.ok(!none.campuses.LMS1.rows.some((r) => r.id.endsWith('adjustment')) && none.report.includes('NO adjustment'));
    assert.ok(imp.buildImport({ LMS1: H + '\n' + line('01/04/2026', 'Received', 'Fee Received', '10') }, '', { LMS1: 5 }, OPTS).campuses.LMS1.rows.some((r) => r.category === 'import_adjustment_out'));
  });
  t.test('ids are deterministic; opening is zero', () => {
    assert.strictEqual(build().campuses.LMS1.daybook, b.campuses.LMS1.daybook);
    assert.ok(rows.every((r) => /^sheet-LMS1-([0-9a-f]{16}(-\d+)?(-bank)?|adjustment-(fee|other))$/.test(r.id)));
    const o = parseCsv(b.campuses.LMS1.opening);
    assert.deepStrictEqual(o.slice(1).map((r) => r[4]), ['0', '0', '0', '0', '0']);
  });
  t.test('buckets: fee receipts and deposit cash-outs are fee, the rest other', () => {
    assert.strictEqual(rowOf(b, 2).bucket, 'fee'); assert.strictEqual(rowOf(b, 3).bucket, 'fee'); assert.strictEqual(rowOf(b, 4).bucket, 'other'); assert.strictEqual(rowOf(b, 10).bucket, 'other');
    assert.strictEqual(rows.find((r) => r.id === rowOf(b, 3).id + '-bank').bucket, '');
  });
  t.test('--actual: a number adjusts the fee bucket; {fee, other} adjusts each bucket; bad figures are rejected', () => {
    const h = boot(); const close = (rs) => JSON.parse(JSON.stringify(h.ctx.officeBalances_({ cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 }, rs.filter((r) => r.account === 'cash:LMS1'), '2026-10-22').closing.cash));
    const adj = (r) => r.rows.filter((x) => x.id.includes('-adjustment-')).map((x) => x.id.split('-adjustment-')[1]);
    const one = build().campuses.LMS1;
    assert.deepStrictEqual(adj(one), ['fee']); const c1 = close(one.rows); assert.strictEqual(c1.fee + c1.other, 100000); assert.strictEqual(c1.other, close(build({ LMS1 }, {}).campuses.LMS1.rows).other);
    const two = imp.buildImport({ LMS1 }, REVIEW, { LMS1: { fee: 300, other: 20 } }, OPTS).campuses.LMS1;
    assert.deepStrictEqual(adj(two).sort(), ['fee', 'other']); const c2 = close(two.rows); assert.deepStrictEqual([c2.fee, c2.other], [30000, 2000]);
    for (const bad of [-5, '-5', 'abc', null, { fee: -1, other: 0 }, { fee: 1, other: 'x' }]) assert.throws(() => imp.buildImport({ LMS1 }, REVIEW, { LMS1: bad }, OPTS), /actual/i, JSON.stringify(bad));
  });
  t.test('ids come from row content: re-sorting the Sheet gives the same ids; identical rows get a counter', () => {
    const [head, ...body] = LMS1.trim().split('\n');
    const same = line('09/04/2026', 'Paid', 'Internet', '10');
    const a = imp.buildImport({ LMS1: [head, ...body, same, same].join('\n') }, '', {}, OPTS).campuses.LMS1.rows.map((r) => r.id);
    const z = imp.buildImport({ LMS1: [head, same, ...body.reverse(), same].join('\n') }, '', {}, OPTS).campuses.LMS1.rows.map((r) => r.id);
    assert.deepStrictEqual([...a].sort(), [...z].sort()); assert.strictEqual(new Set(a).size, a.length);
    assert.ok(a.filter((id) => /-1$/.test(id)).length === 1);
  });
  t.test('Column 1 date header and missing campus tabs', () => {
    const alt = 'Timestamp,Column 1,Type of Transaction,Category,Particulars,Amount\n,2026-04-02,Received,Fee Online,x,5\n';
    const r = imp.buildImport({ LMS2: alt }, '', {}, OPTS);
    assert.strictEqual(r.campuses.LMS2.rows[0].category, 'fee_online');
    assert.ok(r.report.includes('LMS1: no tab file found'));
  });
  t.test('officeImportFromDrive loads opening then daybook per campus folder, idempotently', () => {
    const h = boot(); h.addConfig(); const book = h.addBook('LMS1', '2026-27'); h.setNow(new Date('2026-10-22T10:00:00Z'));
    h.run("if (OFFICE_TABLES.DayBook.indexOf('collection') === -1) OFFICE_TABLES.DayBook.push('collection')"); // the Day Book branch adds this column
    const put = (folder, name, text) => folder.createFile({ getName: () => name, getContentType: () => 'text/csv', getBytes: () => [], getDataAsString: () => text });
    const f = h.drive.root.createFolder('LMS1'); put(f, 'opening-2026-27.csv', b.campuses.LMS1.opening); put(f, 'daybook.csv', b.campuses.LMS1.daybook);
    put(h.drive.root.createFolder('LMS2'), 'daybook.csv', 'x'); // no opening file: reported, others unaffected
    h.drive.root.createFolder('notes');
    const res = JSON.parse(JSON.stringify(h.ctx.officeImportFromDrive(h.drive.root.id)));
    assert.strictEqual(res[0].opening.appended, 5); assert.strictEqual(res[0].daybook.appended, rows.length);
    assert.ok(/MISSING_FILE/.test(res[1].error));
    const stored = h.ctx.officeRows_(book, 'DayBook');
    assert.strictEqual(stored.length, rows.length);
    assert.strictEqual(stored.find((r) => r.id === rowOf(b, 10).id).collection, 'field_trips');
    const cc = JSON.parse(JSON.stringify(h.call('daybook.balances', { campus: 'LMS1', date: '2026-10-22' }).closing.cash)); assert.strictEqual(cc.fee + cc.other, 100000);
    const again = JSON.parse(JSON.stringify(h.ctx.officeImportFromDrive(h.drive.root.id)));
    assert.deepStrictEqual([again[0].daybook.appended, again[0].daybook.duplicates], [0, rows.length]);
  });
  t.test('loader refuses a collection column that is not deployed', () => {
    const h = boot(); h.addConfig(); h.addBook('LMS1', '2026-27');
    h.ctx.officeImportRows_('LMS1', '2026-27', 'Opening', b.campuses.LMS1.opening);
    if (!h.run("OFFICE_TABLES.DayBook.indexOf('collection') !== -1")) assert.throws(() => h.ctx.officeImportRows_('LMS1', '2026-27', 'DayBook', b.campuses.LMS1.daybook), /collection column is not deployed/);
  });
};
