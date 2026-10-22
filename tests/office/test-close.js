// Day close and owner-only reopen (apps-script/office-close.gs).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
  ],
};
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); const b = h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26');
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    h.book = b;
    return h;
  };
  let n = 0;
  const add = (h, o) => h.call('daybook.add', Object.assign({ id: 'e' + (++n), campus: 'LMS1', entry_date: '2026-10-20', account: 'cash:LMS1', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 1000 }, o), 'clerk-token');
  const close = (h, d, o) => h.call('day.close', Object.assign({ id: 'c' + (++n), campus: 'LMS1', close_date: d }, o), 'fh-token');
  const reopen = (h, d, o, tok) => h.call('day.reopen', Object.assign({ id: 'r' + (++n), campus: 'LMS1', close_date: d, reason: 'wrong amount' }, o), tok || 'owner-token');
  const tick = (h, iso) => h.setNow(new Date(iso));

  t.test('add dated to a closed day returns DAY_CLOSED with code; other days still work', () => {
    const h = fresh();
    add(h, { id: 'keep' });
    assert.equal(close(h, '2026-10-20').success, true);
    const r = add(h, { id: 'late' });
    assert.deepEqual(J(r), { success: false, code: 'DAY_CLOSED', error: 'DAY_CLOSED' });
    assert.equal(h.call('daybook.list', { campus: 'LMS1', from: '2026-10-20' }, 'clerk-token').entries.length, 1);
    assert.equal(add(h, { id: 'today', entry_date: '2026-10-21' }).success, true);
    assert.equal(add(h, { id: 'keep' }).duplicate, true, 'retry of a saved entry stays a duplicate');
  });

  t.test('reverse of an entry in a closed day posts to today', () => {
    const h = fresh();
    add(h, { id: 'orig' });
    close(h, '2026-10-20');
    const r = h.call('daybook.reverse', { id: 'rv', campus: 'LMS1', reverses: 'orig' }, 'clerk-token');
    assert.equal(r.success, true);
    const e = h.call('daybook.list', { campus: 'LMS1', from: '2026-10-21' }, 'clerk-token').entries;
    assert.deepEqual(e.map((x) => [x.id, x.entry_date]), [['rv', '2026-10-21']]);
  });

  t.test('a closed today (hand-written Closes row) makes reverse return DAY_CLOSED', () => {
    const h = fresh();
    add(h, { id: 'orig' });
    h.ctx.officeWriteRow_(h.book, 'Closes', { id: 'x', campus: 'LMS1', close_date: '2026-10-21', closing_json: '{}', created_at: '2026-10-21T09:00:00.000Z' });
    const r = h.call('daybook.reverse', { id: 'rv', campus: 'LMS1', reverses: 'orig' }, 'clerk-token');
    assert.equal(r.code, 'DAY_CLOSED');
    assert.equal(h.call('daybook.list', { campus: 'LMS1', from: '2026-10-21' }, 'clerk-token').entries.length, 0);
  });

  t.test('close by FeeClerk refused', () => {
    const h = fresh();
    assert.equal(h.call('day.close', { id: 'c', campus: 'LMS1', close_date: '2026-10-20' }, 'clerk-token').error, 'FORBIDDEN_ROLE');
  });

  t.test('close stores closing balances equal to daybook.balances', () => {
    const h = fresh();
    add(h, { amount_paise: 700 });
    add(h, { direction: 'OUT', category: 'stationery', bucket: 'petty', amount_paise: 200 });
    const r = close(h, '2026-10-20');
    const b = h.call('daybook.balances', { campus: 'LMS1', date: '2026-10-20' }, 'clerk-token');
    const row = h.ctx.officeRows_(h.book, 'Closes')[0];
    const want = { opening: b.opening, in: b.in, out: b.out, closing: b.closing };
    assert.deepEqual(JSON.parse(row.closing_json), J(want));
    assert.deepEqual(J(r.closing), J(want));
    assert.equal(row.close_date, '2026-10-20');
    assert.equal(h.ctx.officeRows_(h.book, 'Audit').filter((a) => a.action === 'day.close').length, 1);
  });

  t.test('close twice returns ALREADY_CLOSED; same id retry is a duplicate', () => {
    const h = fresh();
    assert.equal(close(h, '2026-10-20', { id: 'c1' }).success, true);
    assert.equal(close(h, '2026-10-20', { id: 'c2' }).error, 'ALREADY_CLOSED');
    assert.equal(close(h, '2026-10-20', { id: 'c1' }).duplicate, true);
  });

  t.test('close validation: date shape, future, missing id', () => {
    const h = fresh();
    assert.equal(close(h, '2026-02-30').error, 'BAD_DATE');
    assert.equal(close(h, '21/10/2026').error, 'BAD_DATE');
    assert.equal(close(h, '2026-10-22').error, 'FUTURE_DATE');
    assert.equal(close(h, '2026-10-21').error, 'CANNOT_CLOSE_TODAY');
    assert.equal(h.call('day.close', { campus: 'LMS1', close_date: '2026-10-20' }, 'fh-token').error, 'MISSING_ID');
  });

  t.test('PREVIOUS_DAY_OPEN when the last earlier day with entries is not closed', () => {
    const h = fresh();
    add(h, { entry_date: '2026-10-18' });
    add(h, { entry_date: '2026-10-20' });
    assert.equal(close(h, '2026-10-20').error, 'PREVIOUS_DAY_OPEN');
    assert.equal(close(h, '2026-10-18').success, true, 'first day of the book has no predecessor');
    assert.equal(close(h, '2026-10-20').success, true, 'empty days between are ignored');
  });

  t.test('reopen by FinanceHead refused; by Owner with reason works, is audited and unfreezes', () => {
    const h = fresh();
    add(h, { id: 'a' }); tick(h, '2026-10-21T10:01:00Z');
    close(h, '2026-10-20'); tick(h, '2026-10-21T10:02:00Z');
    assert.equal(reopen(h, '2026-10-20', {}, 'fh-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.ctx.officeIsClosed_(h.book, '2026-10-20'), true);
    assert.equal(reopen(h, '2026-10-20').success, true);
    const rows = h.ctx.officeRows_(h.book, 'Reopens');
    assert.equal(rows.length, 1); assert.equal(rows[0].reason, 'wrong amount'); assert.equal(rows[0].created_by, 'owner@example.org');
    assert.equal(h.ctx.officeRows_(h.book, 'Audit').filter((x) => x.action === 'day.reopen').length, 1);
    assert.equal(add(h, { id: 'b' }).success, true, 'reopened day accepts entries');
    tick(h, '2026-10-21T10:03:00Z');
    assert.equal(close(h, '2026-10-20').success, true, 'a reopened day can be closed again');
    assert.equal(add(h, { id: 'c' }).code, 'DAY_CLOSED');
  });

  t.test('reopen then close within the same instant still reads as closed', () => {
    const h = fresh();
    close(h, '2026-10-20'); reopen(h, '2026-10-20');
    assert.equal(h.ctx.officeIsClosed_(h.book, '2026-10-20'), false);
    close(h, '2026-10-20');
    assert.equal(h.ctx.officeIsClosed_(h.book, '2026-10-20'), true);
  });

  t.test('reopen without reason refused; reopen of an open day is NOT_CLOSED', () => {
    const h = fresh();
    close(h, '2026-10-20');
    ['', '   ', undefined].forEach((r) => assert.equal(reopen(h, '2026-10-20', { reason: r }).error, 'REASON_REQUIRED'));
    assert.equal(reopen(h, '2026-10-21').error, 'NOT_CLOSED');
    assert.equal(reopen(h, '2026-10-19').error, 'LATER_DAY_CLOSED', 'an older day sits under the closed 20th');
    assert.equal(h.ctx.officeIsClosed_(h.book, '2026-10-20'), true);
  });
  // C1 / R36: a date is frozen while any later closed day exists; reopen goes latest-first.
  t.test('back-dated entry before closed days is refused; closed balances stay fixed (probe)', () => {
    const h = fresh();
    add(h, { entry_date: '2026-10-19' }); add(h, { entry_date: '2026-10-20' });
    assert.equal(close(h, '2026-10-19').success, true);
    const c20 = close(h, '2026-10-20');
    assert.equal(c20.closing.closing.cash.fee, 2000);
    const r = add(h, { entry_date: '2026-10-18', amount_paise: 50000 });
    assert.deepEqual(J(r), { success: false, code: 'DAY_CLOSED', error: 'DAY_CLOSED' });
    assert.equal(h.call('daybook.balances', { campus: 'LMS1', date: '2026-10-20' }, 'fh-token').closing.cash.fee, 2000);
    assert.equal(add(h, { entry_date: '2026-10-21' }).success, true, 'today stays open');
  });

  t.test('an empty day before a closed day is frozen for reports too', () => {
    const h = fresh();
    add(h, { entry_date: '2026-10-20' }); close(h, '2026-10-20');
    const rep = h.call('report.submit', { id: 'rp', campus: 'LMS1', report_date: '2026-10-19', hourly: [], footfall: 0, cash: { petty: 0, fee: 0, other: 0 } }, 'clerk-token');
    assert.equal(rep.code, 'DAY_CLOSED');
    assert.equal(close(h, '2026-10-19').error, 'ALREADY_CLOSED', 'a frozen day reads as closed');
  });

  t.test('reopen of an older day is refused while a later day is closed (LATER_DAY_CLOSED); latest-first works', () => {
    const h = fresh();
    add(h, { entry_date: '2026-10-19' }); add(h, { entry_date: '2026-10-20' });
    tick(h, '2026-10-21T10:01:00Z'); close(h, '2026-10-19');
    tick(h, '2026-10-21T10:02:00Z'); close(h, '2026-10-20');
    tick(h, '2026-10-21T10:03:00Z');
    assert.deepEqual(J(reopen(h, '2026-10-19')), { success: false, code: 'LATER_DAY_CLOSED', error: 'LATER_DAY_CLOSED' });
    assert.equal(h.ctx.officeRows_(h.book, 'Reopens').length, 0);
    assert.equal(reopen(h, '2026-10-20').success, true);
    assert.equal(add(h, { entry_date: '2026-10-19' }).code, 'DAY_CLOSED', '19 itself is still closed');
    tick(h, '2026-10-21T10:04:00Z');
    assert.equal(reopen(h, '2026-10-19').success, true);
    assert.equal(add(h, { entry_date: '2026-10-18' }).success, true, 'nothing later is closed now');
  });

  t.test('opening.set is locked once any day is closed, even with no entries', () => {
    const h = fresh();
    close(h, '2026-10-20');
    const r = h.call('opening.set', { id: 'op', campus: 'LMS1', balances: [{ mode: 'bank', amount_paise: 5 }] }, 'fh-token');
    assert.equal(r.error, 'OPENING_LOCKED');
  });
  // Review Focus 4: a day close is the cash count; bank, UPI and credit rows keep their real date.
  t.test('late bank/UPI/credit rows dated into a closed day are accepted; a cash row that day is DAY_CLOSED', () => {
    const h = fresh();
    const cfg = h.ctx.officeConfigBook_();
    h.ctx.officeWriteRow_(cfg, 'Accounts', { id: 'pump1', label: 'Pump', kind: 'credit', campus: 'LMS1', active: 'true' });
    h.ctx.officeWriteRow_(cfg, 'Vehicles', { reg: 'HP665805', label: 'Bus 1', kind: 'bus', campus: 'LMS1', active: 'true' });
    add(h, { id: 'keep' });
    assert.equal(close(h, '2026-10-20').success, true);
    const fh = (o) => h.call('daybook.add', Object.assign({ id: 'e' + (++n), campus: 'LMS1', entry_date: '2026-10-20', account: 'bank:LMS1', direction: 'IN', category: 'other_in', amount_paise: 500 }, o), 'fh-token');
    assert.equal(fh({ id: 'bank', mode: 'bank' }).success, true);
    assert.equal(fh({ id: 'upi', mode: 'upi' }).success, true);
    assert.equal(h.call('daybook.add', { id: 'fill', campus: 'LMS1', entry_date: '2026-10-19', account: 'pump1', direction: 'OUT', category: 'fuel', vehicle: 'HP665805',
      litres_ml: 30000, odometer_km: 10, file_id: 'slip', amount_paise: 3000 }, 'clerk-token').success, true, 'credit fill on a frozen day');
    assert.equal(add(h, { id: 'cash' }).code, 'DAY_CLOSED');
    assert.equal(fh({ id: 'cash2', account: 'cash:LMS1', mode: 'cash', bucket: 'other' }).code, 'DAY_CLOSED', 'FinanceHead cash too');
    assert.deepEqual(h.call('daybook.list', { campus: 'LMS1', from: '2026-10-19', to: '2026-10-20' }, 'fh-token').entries.map((x) => x.id).sort(), ['bank', 'fill', 'keep', 'upi']);
    // reversing a bank row while today is closed is not blocked; reversing a cash row is
    h.ctx.officeWriteRow_(h.book, 'Closes', { id: 'x', campus: 'LMS1', close_date: '2026-10-21', closing_json: '{}', created_at: '2026-10-21T09:00:00.000Z' });
    assert.equal(h.call('daybook.reverse', { id: 'rb', campus: 'LMS1', reverses: 'bank' }, 'fh-token').success, true);
    assert.equal(h.call('daybook.reverse', { id: 'rk', campus: 'LMS1', reverses: 'keep' }, 'fh-token').code, 'DAY_CLOSED');
  });
};
