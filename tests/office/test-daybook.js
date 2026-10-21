// Day Book entries, reversal, balances (apps-script/office-daybook.gs).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'other-token': 'other@example.org', 'owner-token': 'owner@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['other@example.org', 'Other', 'LMS2', 'FeeClerk'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
  ],
};
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26');
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    return h;
  };
  let n = 0;
  const e = (o) => Object.assign({ id: 'e' + (++n), campus: 'LMS1', entry_date: '2026-10-20', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 100000, payee: 'P', narration: 'x' }, o);
  const add = (h, o) => h.call('daybook.add', e(o), 'clerk-token');

  t.test('amount 0, negative, float 0.1 and string "1,234.50" are rejected', () => {
    const h = fresh();
    [0, -5, 0.1, 0.1 + 0.2, '1,234.50', '100', null, NaN, 2 ** 60].forEach((a) => assert.equal(add(h, { amount_paise: a }).error, 'BAD_AMOUNT', String(a)));
    assert.equal(h.call('daybook.list', { campus: 'LMS1', from: '2026-10-20' }, 'clerk-token').entries.length, 0);
  });

  t.test('1000 entries of 10 paise sum exactly 10000', () => {
    const h = fresh();
    for (let i = 0; i < 1000; i++) assert.equal(add(h, { id: 'm' + i, amount_paise: 10 }).success, true);
    const b = h.call('daybook.balances', { campus: 'LMS1', date: '2026-10-20' }, 'clerk-token');
    assert.equal(b.in.cash.fee, 10000); assert.equal(b.closing.cash.fee, 10000);
  });

  t.test('balances = opening + in - out per mode and cash bucket', () => {
    const h = fresh();
    h.call('opening.set', { id: 'o', campus: 'LMS1', balances: [{ mode: 'cash', bucket: 'fee', amount_paise: 1000 }, { mode: 'bank', amount_paise: 5000 }] }, 'owner-token');
    add(h, { entry_date: '2026-10-19', amount_paise: 300 });
    add(h, { amount_paise: 700 });
    add(h, { direction: 'OUT', category: 'petty_expense', bucket: 'petty', amount_paise: 200 });
    add(h, { mode: 'bank', bucket: '', amount_paise: 50 });
    add(h, { mode: 'upi', bucket: '', direction: 'OUT', category: 'bill_payment', amount_paise: 9 });
    add(h, { entry_date: '2026-10-21', amount_paise: 4 });
    const b = h.call('daybook.balances', { campus: 'LMS1', date: '2026-10-20' }, 'clerk-token');
    assert.deepEqual(J(b.opening), { cash: { petty: 0, fee: 1300, other: 0 }, bank: 5000, upi: 0 });
    assert.deepEqual(J(b.in), { cash: { petty: 0, fee: 700, other: 0 }, bank: 50, upi: 0 });
    assert.deepEqual(J(b.out), { cash: { petty: 200, fee: 0, other: 0 }, bank: 0, upi: 9 });
    assert.deepEqual(J(b.closing), { cash: { petty: -200, fee: 2000, other: 0 }, bank: 5050, upi: -9 });
  });

  t.test('reverse creates opposite entry and nets to zero', () => {
    const h = fresh();
    add(h, { id: 'orig', entry_date: '2026-10-21', amount_paise: 4200 });
    const r = h.call('daybook.reverse', { id: 'rev', campus: 'LMS1', reverses: 'orig' }, 'clerk-token');
    assert.equal(r.success, true);
    const rows = h.call('daybook.list', { campus: 'LMS1', from: '2026-10-21' }, 'clerk-token').entries;
    const rv = rows.find((x) => x.id === 'rev');
    assert.equal(rv.direction, 'OUT'); assert.equal(rv.reverses, 'orig'); assert.equal(rv.amount_paise, 4200);
    assert.equal(rv.category, 'fee_collection'); assert.equal(rv.narration, 'Reversal of orig'); assert.equal(rv.entry_date, '2026-10-21');
    assert.equal(h.call('daybook.balances', { campus: 'LMS1', date: '2026-10-21' }, 'clerk-token').closing.cash.fee, 0);
    assert.equal(h.call('daybook.reverse', { id: 'rev', campus: 'LMS1', reverses: 'orig' }, 'clerk-token').duplicate, true, 'retry is idempotent');
  });

  t.test('reversing twice, or a reversal, returns ALREADY_REVERSED; unknown is NOT_FOUND', () => {
    const h = fresh();
    add(h, { id: 'orig' });
    assert.equal(h.call('daybook.reverse', { id: 'r1', campus: 'LMS1', reverses: 'orig' }, 'clerk-token').success, true);
    assert.equal(h.call('daybook.reverse', { id: 'r2', campus: 'LMS1', reverses: 'orig' }, 'clerk-token').error, 'ALREADY_REVERSED');
    assert.equal(h.call('daybook.reverse', { id: 'r3', campus: 'LMS1', reverses: 'r1' }, 'clerk-token').error, 'ALREADY_REVERSED');
    assert.equal(h.call('daybook.reverse', { id: 'r4', campus: 'LMS1', reverses: 'nope' }, 'clerk-token').error, 'NOT_FOUND');
  });

  t.test('validation: bucket, mode, category, direction, dates', () => {
    const h = fresh();
    assert.equal(add(h, { bucket: '' }).error, 'BUCKET_REQUIRED');
    assert.equal(add(h, { bucket: 'till' }).error, 'BUCKET_REQUIRED');
    assert.equal(add(h, { mode: 'bank', bucket: 'fee' }).error, 'BUCKET_NOT_ALLOWED');
    assert.equal(add(h, { mode: 'cheque' }).error, 'BAD_MODE');
    assert.equal(add(h, { category: 'nope' }).error, 'BAD_CATEGORY');
    assert.equal(add(h, { direction: 'OUT' }).error, 'DIRECTION_MISMATCH');
    assert.equal(add(h, { entry_date: '2026-10-22' }).error, 'FUTURE_DATE');
    assert.equal(add(h, { entry_date: '2026-02-30' }).error, 'BAD_DATE');
    assert.equal(add(h, { entry_date: '21/10/2026' }).error, 'BAD_DATE');
    ['2026-13-01', '2026-00-10', '2026-01-32'].forEach((d) => assert.equal(add(h, { entry_date: d }).error, 'BAD_DATE', d));
    assert.equal(h.call('daybook.list', { campus: 'LMS1', from: '2026-13-01' }, 'clerk-token').error, 'BAD_DATE');
    assert.equal(h.call('daybook.list', { campus: 'LMS1', from: '2026-10-01', to: '2026-10-32' }, 'clerk-token').error, 'BAD_DATE');
    assert.equal(h.call('daybook.balances', { campus: 'LMS1', date: '2026-00-10' }, 'clerk-token').error, 'BAD_DATE');
  });

  t.test('same id twice yields one row; entries land in the book of their financial year', () => {
    const h = fresh();
    const a = e({ entry_date: '2026-03-31' });
    assert.equal(h.call('daybook.add', a, 'clerk-token').duplicate, false);
    assert.equal(h.call('daybook.add', a, 'clerk-token').duplicate, true);
    assert.equal(h.call('daybook.list', { campus: 'LMS1', from: '2026-03-01', to: '2026-03-31' }, 'clerk-token').entries.length, 1);
    assert.equal(h.call('daybook.list', { campus: 'LMS1', from: '2026-04-01' }, 'clerk-token').entries.length, 0);
    assert.equal(h.call('daybook.list', { campus: 'LMS1', from: '2026-03-01', to: '2026-04-01' }, 'clerk-token').error, 'RANGE_SPANS_YEARS');
  });

  t.test('daybook.list for another campus is FORBIDDEN_CAMPUS', () => {
    const h = fresh();
    assert.equal(h.call('daybook.list', { campus: 'LMS2', from: '2026-10-20' }, 'clerk-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(h.call('daybook.add', e({ campus: 'LMS2' }), 'clerk-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(h.call('daybook.balances', { campus: 'LMS2', date: '2026-10-20' }, 'clerk-token').error, 'FORBIDDEN_CAMPUS');
  });

  t.test('reverse across the year boundary writes to the new book; NOT_FOUND when neither book has it', () => {
    const h = fresh(); h.addBook('LMS1', '2027-28');
    h.setNow(new Date('2027-03-31T10:00:00Z'));
    add(h, { id: 'old', entry_date: '2027-03-31', amount_paise: 500 });
    h.setNow(new Date('2027-04-02T10:00:00Z'));
    assert.equal(h.call('daybook.reverse', { id: 'r', campus: 'LMS1', reverses: 'old' }, 'clerk-token').success, true);
    assert.deepEqual(h.call('daybook.list', { campus: 'LMS1', from: '2027-04-01', to: '2027-04-02' }, 'clerk-token').entries.map((x) => x.id), ['r']);
    assert.deepEqual(h.call('daybook.list', { campus: 'LMS1', from: '2027-03-31' }, 'clerk-token').entries.map((x) => x.id), ['old']);
    assert.equal(h.call('daybook.reverse', { id: 'r2', campus: 'LMS1', reverses: 'old' }, 'clerk-token').error, 'ALREADY_REVERSED');
    assert.equal(h.call('daybook.reverse', { id: 'r', campus: 'LMS1', reverses: 'old' }, 'clerk-token').duplicate, true);
    assert.equal(h.call('daybook.reverse', { id: 'r3', campus: 'LMS1', reverses: 'nope' }, 'clerk-token').error, 'NOT_FOUND');
  });

  t.test('reverse with no previous-year book is NOT_FOUND, not an error', () => {
    const h = boot(fixture); h.addConfig(); h.addBook('LMS1', '2026-27'); h.setNow(new Date('2026-10-21T10:00:00Z'));
    assert.equal(h.call('daybook.reverse', { id: 'r', campus: 'LMS1', reverses: 'x' }, 'clerk-token').error, 'NOT_FOUND');
  });
};
