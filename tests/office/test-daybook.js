// Day Book entries, reversal, balances (apps-script/office-daybook.gs).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'other-token': 'other@example.org', 'owner-token': 'owner@example.org', 'fh-token': 'fh@example.org', 'am-token': 'am@example.org', 'acct-token': 'acct@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['other@example.org', 'Other', 'LMS2', 'FeeClerk'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['am@example.org', 'Admin Manager', 'LMS1', 'AdminManager'],
    ['acct@example.org', 'Accounts Clerk', 'LMS1', 'Accounts,FeeClerk'],
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
  const e = (o) => Object.assign({ id: 'e' + (++n), campus: 'LMS1', entry_date: '2026-10-20', account: 'cash:LMS1', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 100000, payee: 'P', narration: 'x' }, o);
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
    add(h, { direction: 'OUT', category: 'stationery', bucket: 'petty', amount_paise: 200 });
    h.call('daybook.add', e({ account: 'bank:LMS1', mode: 'bank', bucket: '', amount_paise: 50 }), 'owner-token');
    h.call('daybook.add', e({ account: 'bank:LMS1', mode: 'upi', bucket: '', direction: 'OUT', category: 'utilities', amount_paise: 9 }), 'owner-token');
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
    assert.equal(h.call('daybook.add', e({ account: 'bank:LMS1', mode: 'bank', bucket: 'fee' }), 'owner-token').error, 'BUCKET_NOT_ALLOWED');
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
  // ── Day Book v2: accounts, charged_to, vehicles, fuel, credit, settlements ──
  // Config rows written straight to the fake Config book: pump1 (credit, LMS1), pump2 (credit, LMS2), sbi1 (bank, LMS1),
  // old1 (credit, LMS1, inactive); vehicles HP665805 (LMS1) and HP660001 (LMS1), and HP669999 (inactive).
  const v2 = () => {
    const h = fresh(); h.addBook('LMS2', '2026-27');
    const cfg = h.ctx.officeConfigBook_();
    [['pump1', 'credit', 'LMS1', 'true'], ['pump2', 'credit', 'LMS2', 'true'], ['sbi1', 'bank', 'LMS1', 'true'], ['old1', 'credit', 'LMS1', 'false']]
      .forEach(([id, kind, campus, active]) => h.ctx.officeWriteRow_(cfg, 'Accounts', { id, label: id, kind, campus, active }));
    [['HP665805', 'true'], ['HP660001', 'true'], ['HP669999', 'false']]
      .forEach(([reg, active]) => h.ctx.officeWriteRow_(cfg, 'Vehicles', { reg, label: reg, kind: 'bus', campus: 'LMS1', active }));
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Files', { id: 'slip', campus: 'LMS1', drive_id: 'D1', name: 's.jpg' });
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS2', '2026-27'), 'Files', { id: 'slip2', campus: 'LMS2', drive_id: 'D2', name: 's.jpg' });
    return h;
  };
  const rowsOf = (h, campus, fy) => h.ctx.officeRows_(h.ctx.officeOpen_(campus || 'LMS1', fy || '2026-27'), 'DayBook');
  const fuel = (o) => e(Object.assign({ account: 'pump1', mode: '', bucket: '', direction: 'OUT', category: 'fuel', vehicle: 'HP665805', litres_ml: 40000, odometer_km: 1000, file_id: 'slip' }, o));
  const as = (h, tok, o) => h.call('daybook.add', e(o), tok);

  t.test('account is required, must exist, be active and belong to the entry campus (BAD_ACCOUNT)', () => {
    const h = v2();
    ['nope', 'old1', 'cash:LMS2', 'pump2'].forEach((a) => assert.equal(as(h, 'owner-token', { account: a, mode: '', bucket: '', direction: 'OUT', category: 'fuel' }).error, 'BAD_ACCOUNT', String(a)));
    assert.equal(as(h, 'owner-token', { account: 'cash:LMS2' }).error, 'BAD_ACCOUNT');
    assert.equal(rowsOf(h).length, 0);
  });

  // Review Focus 1
  t.test('Fee Clerk / Admin Manager: bank, another campus, settlement, cash transfer or a non-vehicle credit bill is FORBIDDEN_ACCOUNT and never written', () => {
    const h = v2();
    ['clerk-token', 'am-token'].forEach((tok) => {
      assert.equal(as(h, tok, { account: 'bank:LMS1', mode: 'bank', bucket: '' }).code, 'FORBIDDEN_ACCOUNT', tok + ' bank');
      assert.equal(as(h, tok, { account: 'sbi1', mode: 'upi', bucket: '' }).code, 'FORBIDDEN_ACCOUNT', tok + ' added bank');
      assert.equal(as(h, tok, { account: 'cash:LMS2' }).code, 'FORBIDDEN_ACCOUNT', tok + ' other campus cash');
      assert.equal(as(h, tok, { account: 'pump2', mode: '', bucket: '', direction: 'OUT', category: 'parking', vehicle: 'FLEET' }).code, 'FORBIDDEN_ACCOUNT', tok + ' other campus credit');
      assert.equal(as(h, tok, { account: 'bank:LMS1', mode: 'bank', bucket: '', direction: 'OUT', category: 'credit_settlement', settles_account: 'pump1' }).code, 'FORBIDDEN_ACCOUNT', tok + ' settlement');
      assert.equal(as(h, tok, { direction: 'OUT', category: 'credit_settlement', bucket: 'fee', settles_account: 'pump1' }).code, 'FORBIDDEN_ACCOUNT', tok + ' settlement from cash');
      assert.equal(as(h, tok, { account: 'bank:LMS1', mode: 'bank', bucket: '', direction: 'OUT', category: 'cash_transfer' }).code, 'FORBIDDEN_ACCOUNT', tok + ' cash transfer from bank');
      assert.equal(as(h, tok, { account: 'pump1', mode: '', bucket: '', direction: 'OUT', category: 'stationery' }).code, 'FORBIDDEN_ACCOUNT', tok + ' credit stationery');
    });
    assert.equal(h.call('daybook.add', e({ campus: 'LMS2', account: 'cash:LMS2' }), 'clerk-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(rowsOf(h).length + rowsOf(h, 'LMS2').length, 0, 'nothing written');
    // Allowed for a clerk: own cash, and a credit bill for a vehicle category (fuel fill).
    assert.equal(add(h, {}).success, true);
    assert.equal(as(h, 'clerk-token', { direction: 'OUT', category: 'cash_transfer', bucket: 'fee' }).success, true, 'own cash transfer (P10)');
    assert.equal(as(h, 'am-token', { direction: 'OUT', category: 'cash_transfer', bucket: 'petty' }).success, true, 'own cash transfer (P10)');
    assert.equal(h.call('daybook.add', fuel({}), 'clerk-token').success, true);
    assert.equal(h.call('daybook.add', fuel({ category: 'parking', litres_ml: '', odometer_km: '', file_id: '' }), 'am-token').success, true);
  });

  t.test('FinanceHead, Owner and Accounts (even with FeeClerk) may use bank, credit, settlements and cash transfers (P8)', () => {
    const h = v2();
    ['fh-token', 'owner-token', 'acct-token'].forEach((tok) => {
      assert.equal(as(h, tok, { account: 'bank:LMS1', mode: 'bank', bucket: '' }).success, true, tok + ' bank');
      assert.equal(as(h, tok, { account: 'sbi1', mode: 'upi', bucket: '', direction: 'OUT', category: 'credit_settlement', settles_account: 'pump1', settles: 'B1-B4' }).success, true, tok + ' settlement');
      assert.equal(as(h, tok, { direction: 'OUT', category: 'cash_transfer', bucket: 'fee' }).success, true, tok + ' cash transfer');
      assert.equal(as(h, tok, { account: 'pump1', mode: '', bucket: '', direction: 'OUT', category: 'stationery' }).success, true, tok + ' credit stationery');
    });
  });

  t.test('mode is derived from the account kind; bank needs bank or upi; credit has no bucket', () => {
    const h = v2();
    const o = (x) => as(h, 'owner-token', x);
    assert.equal(o({ id: 'c1', mode: undefined }).success, true);
    assert.equal(o({ mode: 'bank' }).error, 'BAD_MODE', 'cash account sent as bank');
    assert.equal(o({ account: 'bank:LMS1', mode: undefined, bucket: '' }).error, 'BAD_MODE');
    assert.equal(o({ account: 'bank:LMS1', mode: 'cash', bucket: '' }).error, 'BAD_MODE');
    assert.equal(o({ account: 'bank:LMS1', mode: 'credit', bucket: '' }).error, 'BAD_MODE');
    assert.equal(o({ id: 'u1', account: 'bank:LMS1', mode: 'upi', bucket: '' }).success, true);
    assert.equal(o({ account: 'pump1', mode: 'bank', bucket: '', direction: 'OUT', category: 'stationery' }).error, 'BAD_MODE');
    assert.equal(o({ account: 'pump1', mode: '', bucket: 'petty', direction: 'OUT', category: 'stationery' }).error, 'BUCKET_NOT_ALLOWED');
    assert.equal(o({ id: 'k1', account: 'pump1', mode: 'credit', bucket: '', direction: 'OUT', category: 'stationery' }).success, true);
    const by = Object.fromEntries(rowsOf(h).map((r) => [r.id, r]));
    assert.deepEqual([by.c1.mode, by.c1.bucket, by.c1.account], ['cash', 'fee', 'cash:LMS1']);
    assert.deepEqual([by.u1.mode, by.u1.bucket, by.u1.account], ['upi', '', 'bank:LMS1']);
    assert.deepEqual([by.k1.mode, by.k1.bucket, by.k1.account, by.k1.source], ['credit', '', 'pump1', 'live']);
  });

  t.test('credit accounts take only OUT school/transport categories (FORBIDDEN_ACCOUNT)', () => {
    const h = v2();
    const o = (x) => as(h, 'owner-token', Object.assign({ account: 'pump1', mode: '', bucket: '' }, x));
    assert.equal(o({}).code, 'FORBIDDEN_ACCOUNT', 'fee_collection IN');
    assert.equal(o({ category: 'transport_income', vehicle: 'HP665805' }).code, 'FORBIDDEN_ACCOUNT', 'transport IN');
    assert.equal(o({ direction: 'OUT', category: 'cash_transfer' }).code, 'FORBIDDEN_ACCOUNT', 'movement');
    assert.equal(o({ direction: 'OUT', category: 'vehicle_service', vehicle: 'HP665805' }).success, true);
    assert.equal(as(h, 'owner-token', { account: 'bank:LMS1', mode: 'bank', bucket: '', direction: 'OUT', category: 'cash_transfer' }).code, 'FORBIDDEN_ACCOUNT', 'cash transfer only from cash');
  });

  t.test('charged_to defaults to the campus; LMS1..6, HES and CHAIRMAN accepted; anything else BAD_CHARGED_TO', () => {
    const h = v2();
    assert.equal(add(h, { id: 'd1' }).success, true);
    assert.equal(add(h, { id: 'd2', charged_to: 'HES', direction: 'OUT', category: 'stationery', bucket: 'petty' }).success, true);
    assert.equal(add(h, { id: 'd3', charged_to: 'CHAIRMAN', direction: 'OUT', category: 'chairman_personal', bucket: 'petty' }).success, true);
    ['LMS9', 'hes', 'ALL'].forEach((c) => assert.equal(add(h, { charged_to: c }).error, 'BAD_CHARGED_TO', c));
    const by = Object.fromEntries(rowsOf(h).map((r) => [r.id, r.charged_to]));
    assert.deepEqual(by, { d1: 'LMS1', d2: 'HES', d3: 'CHAIRMAN' });
  });

  t.test('inactive categories are refused (CATEGORY_INACTIVE); reversing an old row of one still works', () => {
    const h = v2();
    ['petty_expense', 'bill_payment', 'fee_cheque'].forEach((c) => {
      const cat = h.ctx.officeCategory_(c);
      assert.equal(add(h, { category: c, direction: cat.direction, bucket: 'petty' }).error, 'CATEGORY_INACTIVE', c);
    });
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'DayBook', { id: 'oldp', campus: 'LMS1', entry_date: '2026-10-01', direction: 'OUT', mode: 'cash', bucket: 'petty', category: 'petty_expense', amount_paise: 300 });
    assert.equal(h.call('daybook.reverse', { id: 'rv', campus: 'LMS1', reverses: 'oldp' }, 'clerk-token').success, true);
  });

  t.test('vehicles: required for vehicle categories, normalised, FLEET allowed, unknown/inactive/on other categories BAD_VEHICLE', () => {
    const h = v2();
    const o = (x) => as(h, 'owner-token', Object.assign({ account: 'pump1', mode: '', bucket: '', direction: 'OUT', category: 'parking' }, x));
    assert.equal(o({ vehicle: '' }).error, 'VEHICLE_REQUIRED');
    assert.equal(o({ vehicle: undefined }).error, 'VEHICLE_REQUIRED');
    assert.equal(o({ vehicle: 'HP00XX' }).error, 'BAD_VEHICLE');
    assert.equal(o({ vehicle: 'HP669999' }).error, 'BAD_VEHICLE', 'inactive');
    assert.equal(o({ id: 'p1', vehicle: 'hp 66-5805' }).success, true);
    assert.equal(o({ id: 'p2', vehicle: 'fleet' }).success, true);
    assert.equal(h.call('daybook.add', fuel({ vehicle: 'FLEET' }), 'clerk-token').error, 'VEHICLE_REQUIRED', 'fuel needs a real vehicle (P9)');
    assert.equal(add(h, { vehicle: 'HP665805', direction: 'OUT', category: 'stationery', bucket: 'petty' }).error, 'BAD_VEHICLE');
    assert.equal(add(h, { vehicle: 'FLEET' }).error, 'BAD_VEHICLE');
    const by = Object.fromEntries(rowsOf(h).map((r) => [r.id, r.vehicle]));
    assert.deepEqual(by, { p1: 'HP665805', p2: 'FLEET' });
  });

  t.test('fuel needs litres (ml > 0), odometer (km >= 0) and a photo; other categories must leave them blank (BAD_FIELD)', () => {
    const h = v2();
    const f = (x) => h.call('daybook.add', fuel(x), 'clerk-token');
    [undefined, '', 0, -1, 1.5, '20'].forEach((v) => assert.equal(f({ litres_ml: v }).error, 'LITRES_REQUIRED', String(v)));
    [undefined, '', -1, 1.5, '900'].forEach((v) => assert.equal(f({ odometer_km: v }).error, 'ODOMETER_REQUIRED', String(v)));
    assert.equal(f({ file_id: '' }).code, 'FILE_REQUIRED');
    assert.equal(f({ file_id: 'nope' }).code, 'FILE_MISSING');
    assert.equal(f({ file_id: 'slip2' }).code, 'FILE_MISSING', "another campus's file");
    assert.equal(f({ id: 'f0', odometer_km: 0 }).success, true, 'a new meter may read 0');
    assert.equal(add(h, { direction: 'OUT', category: 'stationery', bucket: 'petty', litres_ml: 5 }).error, 'BAD_FIELD');
    assert.equal(add(h, { direction: 'OUT', category: 'stationery', bucket: 'petty', odometer_km: 5 }).error, 'BAD_FIELD');
    assert.equal(h.call('daybook.add', fuel({ category: 'parking', file_id: '' }), 'clerk-token').error, 'BAD_FIELD');
    assert.equal(f({ id: 'f1', litres_ml: 45500, odometer_km: 1200, supplier_bill_no: ' 778 ', charged_to: 'HES', odometer_note: '' }).success, true);
    const r = rowsOf(h).find((x) => x.id === 'f1');
    assert.deepEqual([r.litres_ml, r.odometer_km, r.vehicle, r.account, r.mode, r.supplier_bill_no, r.charged_to, r.file_id], [45500, 1200, 'HP665805', 'pump1', 'credit', '778', 'HES', 'slip']);
  });

  // Review Focus 2
  t.test('fuel odometer lower than the vehicle\'s highest earlier fill is ODOMETER_BACKWARDS unless odometer_note explains it', () => {
    const h = v2();
    const f = (x) => h.call('daybook.add', fuel(x), 'clerk-token');
    assert.equal(f({ id: 'py', entry_date: '2026-03-30', odometer_km: 800 }).success, true, 'previous-year book');
    assert.equal(rowsOf(h, 'LMS1', '2025-26').length, 1);
    assert.equal(f({ id: 'a', entry_date: '2026-10-18', odometer_km: 1000 }).success, true);
    assert.equal(f({ id: 'b', entry_date: '2026-10-20', odometer_km: 900 }).code, 'ODOMETER_BACKWARDS');
    assert.equal(f({ entry_date: '2026-10-20', odometer_km: 790, vehicle: 'hp-66-5805' }).code, 'ODOMETER_BACKWARDS', 'normalised reg, below last year too');
    assert.equal(f({ id: 'b2', entry_date: '2026-10-20', odometer_km: 900, odometer_note: 'meter replaced' }).success, true);
    assert.equal(f({ id: 'c', entry_date: '2026-10-20', odometer_km: 1000 }).success, true, 'equal is allowed');
    assert.equal(f({ id: 'd', entry_date: '2026-10-17', odometer_km: 950 }).success, true, 'only fills dated on or before this one count');
    assert.equal(f({ id: 'o', entry_date: '2026-10-20', odometer_km: 5, vehicle: 'HP660001' }).success, true, 'other vehicle');
    // a typo'd odometer that was reversed no longer blocks
    assert.equal(f({ id: 'typo', entry_date: '2026-10-21', odometer_km: 99999 }).success, true);
    assert.equal(f({ entry_date: '2026-10-21', odometer_km: 1100 }).code, 'ODOMETER_BACKWARDS');
    assert.equal(h.call('daybook.reverse', { id: 'rv-typo', campus: 'LMS1', reverses: 'typo' }, 'clerk-token').success, true);
    assert.equal(f({ id: 'e', entry_date: '2026-10-21', odometer_km: 1100 }).success, true);
    assert.equal(rowsOf(h).find((r) => r.id === 'b2').odometer_note, 'meter replaced');
  });

  t.test('odometer readings that are not finite numbers are ignored (P10)', () => {
    const h = v2();
    const ss = h.ctx.officeOpen_('LMS1', '2026-27');
    const fill = (id, km) => h.ctx.officeWriteRow_(ss, 'DayBook', { id, campus: 'LMS1', entry_date: '2026-10-15', direction: 'OUT', mode: 'credit', category: 'fuel', amount_paise: 1, account: 'pump1', vehicle: 'HP665805', litres_ml: 1, odometer_km: km });
    fill('g1', 'abc'); fill('g2', ''); fill('g3', 2000);
    assert.equal(h.ctx.officeLastOdometer_('LMS1', 'HP665805', '2026-10-20'), 2000);
    assert.equal(h.call('daybook.add', fuel({ odometer_km: 1500 }), 'clerk-token').code, 'ODOMETER_BACKWARDS', 'a garbled row does not switch the check off');
  });

  t.test('credit_settlement needs a bank account and a credit settles_account of the campus; settles_account elsewhere is NOT_A_SETTLEMENT', () => {
    const h = v2();
    const s = (x) => as(h, 'fh-token', Object.assign({ account: 'sbi1', mode: 'bank', bucket: '', direction: 'OUT', category: 'credit_settlement', settles_account: 'pump1' }, x));
    assert.equal(s({ account: 'cash:LMS1', mode: '', bucket: 'fee' }).error, 'SETTLEMENT_ACCOUNT_REQUIRED', 'from cash');
    assert.equal(s({ account: 'pump1', mode: '' }).error, 'SETTLEMENT_ACCOUNT_REQUIRED', 'from credit');
    ['', undefined, 'nope', 'bank:LMS1', 'cash:LMS1', 'sbi1', 'old1'].forEach((a) => assert.equal(s({ settles_account: a }).error, 'SETTLEMENT_ACCOUNT_REQUIRED', String(a)));
    assert.equal(as(h, 'fh-token', { direction: 'OUT', category: 'stationery', bucket: 'petty', settles_account: 'pump1' }).error, 'NOT_A_SETTLEMENT');
    assert.equal(as(h, 'fh-token', { direction: 'OUT', category: 'stationery', bucket: 'petty', settles: 'Stmt 12' }).error, 'NOT_A_SETTLEMENT', 'settles too (P9)');
    assert.equal(s({ id: 's1', settles: 'Stmt 12' }).success, true);
    assert.equal(s({ id: 's2', settles_account: 'pump2' }).success, true, 'another campus pump (P10)');
    assert.deepEqual([rowsOf(h).find((x) => x.id === 's2').settles_account, rowsOf(h, 'LMS2').length], ['pump2', 0], 'stays in the bank campus book');
    const r = rowsOf(h).find((x) => x.id === 's1');
    assert.deepEqual([r.account, r.mode, r.settles_account, r.settles], ['sbi1', 'bank', 'pump1', 'Stmt 12']);
  });

  t.test('reversal copies account, charged_to, vehicle and the fuel/settlement fields', () => {
    const h = v2();
    assert.equal(h.call('daybook.add', fuel({ id: 'f', charged_to: 'HES', supplier_bill_no: 'B9', odometer_note: 'n' }), 'clerk-token').success, true);
    assert.equal(h.call('daybook.reverse', { id: 'rf', campus: 'LMS1', reverses: 'f' }, 'clerk-token').success, true);
    assert.equal(as(h, 'fh-token', { id: 's', account: 'sbi1', mode: 'upi', bucket: '', direction: 'OUT', category: 'credit_settlement', settles_account: 'pump1', settles: 'B9' }).success, true);
    assert.equal(h.call('daybook.reverse', { id: 'rs', campus: 'LMS1', reverses: 's' }, 'fh-token').success, true);
    const by = Object.fromEntries(rowsOf(h).map((r) => [r.id, r]));
    const keep = ['account', 'charged_to', 'vehicle', 'litres_ml', 'odometer_km', 'odometer_note', 'supplier_bill_no', 'settles_account', 'settles', 'mode', 'bucket', 'category', 'amount_paise'];
    keep.forEach((k) => { assert.deepEqual(by.rf[k], by.f[k], k); assert.deepEqual(by.rs[k], by.s[k], k); });
    assert.deepEqual([by.rf.direction, by.rf.source, by.rf.account, by.rf.vehicle, by.rf.charged_to], ['IN', 'live', 'pump1', 'HP665805', 'HES']);
  });

  t.test('Fee Clerk cannot reverse a bank row or a settlement (FORBIDDEN_ACCOUNT)', () => {
    const h = v2();
    as(h, 'fh-token', { id: 'b', account: 'bank:LMS1', mode: 'bank', bucket: '' });
    assert.equal(h.call('daybook.reverse', { id: 'rb', campus: 'LMS1', reverses: 'b' }, 'clerk-token').code, 'FORBIDDEN_ACCOUNT');
    assert.equal(h.call('daybook.reverse', { id: 'rb', campus: 'LMS1', reverses: 'b' }, 'fh-token').success, true);
    as(h, 'fh-token', { id: 's', account: 'sbi1', mode: 'bank', bucket: '', direction: 'OUT', category: 'credit_settlement', settles_account: 'pump1' });
    assert.equal(h.call('daybook.reverse', { id: 'rs', campus: 'LMS1', reverses: 's' }, 'clerk-token').code, 'FORBIDDEN_ACCOUNT', 'settlement');
  });

  t.test('a v1-shaped entry with no account saves to the campus cash or bank account (pre-deploy outbox)', () => {
    const h = fresh();
    const v1 = (o) => { const d = e(o); delete d.account; return d; };
    assert.equal(h.call('daybook.add', v1({ id: 'v1c' }), 'clerk-token').success, true);
    assert.equal(rowsOf(h).find((r) => r.id === 'v1c').account, 'cash:LMS1');
    const cat = h.call('config.get', {}, 'owner-token').categories.find((c) => c.id === 'fee_online');
    assert.equal(h.call('daybook.add', v1({ id: 'v1b', mode: 'upi', bucket: '', category: 'fee_online' }), 'owner-token').success, true, cat && cat.id);
    assert.equal(rowsOf(h).find((r) => r.id === 'v1b').account, 'bank:LMS1');
  });

  t.test('an old-style row (no account) balances as cash and defaults account/charged_to; credit rows are not cash or bank', () => {
    const h = v2();
    const ss = h.ctx.officeOpen_('LMS1', '2026-27');
    h.ctx.officeWriteRow_(ss, 'DayBook', { id: 'old', campus: 'LMS1', entry_date: '2026-10-20', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 700 });
    h.ctx.officeWriteRow_(ss, 'DayBook', { id: 'oldb', campus: 'LMS1', entry_date: '2026-10-20', direction: 'IN', mode: 'upi', bucket: '', category: 'other_in', amount_paise: 30 });
    assert.equal(h.call('daybook.add', fuel({ amount_paise: 5000 }), 'clerk-token').success, true);
    const b = h.call('daybook.balances', { campus: 'LMS1', date: '2026-10-20' }, 'clerk-token');
    assert.deepEqual(J(b.closing), { cash: { petty: 0, fee: 700, other: 0 }, bank: 0, upi: 30 });
    const old = rowsOf(h).find((r) => r.id === 'old'), oldb = rowsOf(h).find((r) => r.id === 'oldb');
    assert.deepEqual([h.ctx.officeRowAccount_(old), h.ctx.officeRowChargedTo_(old)], ['cash:LMS1', 'LMS1']);
    assert.deepEqual([h.ctx.officeRowAccount_(oldb), h.ctx.officeRowChargedTo_(oldb)], ['bank:LMS1', 'LMS1']);
    assert.equal(h.call('daybook.reverse', { id: 'rold', campus: 'LMS1', reverses: 'old' }, 'clerk-token').success, true);
    const rv = rowsOf(h).find((r) => r.id === 'rold');
    assert.deepEqual([rv.account, rv.charged_to, rv.source, rv.mode, rv.bucket], ['cash:LMS1', 'LMS1', 'live', 'cash', 'fee']);
  });
  t.test('a retry of a saved entry is a duplicate before validation, even after its account or vehicle is switched off (P9)', () => {
    const h = v2();
    const fill = fuel({ id: 'keep' });
    assert.equal(h.call('daybook.add', fill, 'clerk-token').success, true);
    const cfg = h.ctx.officeConfigBook_();
    // switch both off: Config rows are append-only text, so overwrite the active cells in the fake sheets
    const off = (tab, key) => { const v = cfg.getSheetByName(tab).getDataRange().getValues(); const i = v.findIndex((r) => r[0] === key); cfg.getSheetByName(tab).getRange(i + 1, 5).setValues([['false']]); };
    off('Accounts', 'pump1'); off('Vehicles', 'HP665805');
    assert.equal(h.call('daybook.add', fuel({}), 'clerk-token').error, 'BAD_ACCOUNT', 'new entries see the change');
    const r = h.call('daybook.add', fill, 'clerk-token');
    assert.deepEqual([r.success, r.duplicate, r.id], [true, true, 'keep']);
    assert.equal(rowsOf(h).length, 1);
  });

  // ── student collection heads ──
  const sc = (o) => e(Object.assign({ category: 'student_collection', collection: 'mun', bucket: 'other' }, o));
  const scPaid = (o) => e(Object.assign({ category: 'student_collection_paid', direction: 'OUT', collection: 'mun', bucket: 'other', file_id: 'slip' }, o));

  t.test('DayBook has a trailing collection column', () => {
    const h = v2();
    const head = h.ctx.OFFICE_TABLES.DayBook;
    assert.equal(head[head.length - 1], 'collection');
  });

  t.test('student collection categories need an active head (COLLECTION_REQUIRED / BAD_COLLECTION) and it is stored', () => {
    const h = v2();
    const add = (d) => h.call('daybook.add', d, 'clerk-token');
    [sc, scPaid].forEach((mk) => {
      assert.equal(add(mk({ collection: '' })).code, 'COLLECTION_REQUIRED');
      assert.equal(add(mk({ collection: undefined })).code, 'COLLECTION_REQUIRED');
      assert.equal(add(mk({ collection: 'nope' })).code, 'BAD_COLLECTION');
    });
    h.call('collection.set_active', { id: 'mun', active: false }, 'fh-token');
    assert.equal(add(sc({})).code, 'BAD_COLLECTION', 'switched off');
    h.call('collection.set_active', { id: 'mun', active: true }, 'fh-token');
    assert.equal(add(sc({ id: 'c1' })).success, true);
    assert.equal(add(scPaid({ id: 'c2' })).success, true);
    assert.deepEqual([rowsOf(h).find((r) => r.id === 'c1').collection, rowsOf(h).find((r) => r.id === 'c2').collection], ['mun', 'mun']);
    assert.equal(rowsOf(h).length, 2);
  });

  t.test('a collection on any other category is BAD_FIELD', () => {
    const h = v2();
    assert.equal(h.call('daybook.add', e({ collection: 'mun' }), 'clerk-token').error, 'BAD_FIELD');
    assert.equal(h.call('daybook.add', e({ collection: '' }), 'clerk-token').success, true);
    assert.equal(rowsOf(h).length, 1);
  });

  t.test('reversal copies the collection', () => {
    const h = v2();
    h.call('daybook.add', sc({ id: 'c1', entry_date: '2026-10-21' }), 'clerk-token');
    assert.equal(h.call('daybook.reverse', { id: 'rc1', campus: 'LMS1', reverses: 'c1' }, 'clerk-token').success, true);
    assert.equal(rowsOf(h).find((r) => r.id === 'rc1').collection, 'mun');
  });
};
