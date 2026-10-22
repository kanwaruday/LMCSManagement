// Ledger summary (apps-script/office-ledger.gs): per school, accounts, owed to suppliers, vehicles, fuel.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'owner-token': 'owner@example.org', 'fh-token': 'fh@example.org', 'clerk-token': 'clerk@example.org', 'pr1-token': 'pr1@example.org', 'co-token': 'co@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['pr1@example.org', 'Principal One', 'LMS1', 'Principal'],
    ['co@example.org', 'Coordinator', 'ALL', 'Coordinator'],
  ],
};
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  // LMS1 and LMS2 books for 2026-27 (LMS3..HES have none); pump1 (credit, LMS1), pump2 (credit, LMS2), sbi1 (bank, LMS1).
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS2', '2026-27');
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    const cfg = h.ctx.officeConfigBook_();
    [['pump1', 'credit', 'LMS1'], ['pump2', 'credit', 'LMS2'], ['sbi1', 'bank', 'LMS1']]
      .forEach(([id, kind, campus]) => h.ctx.officeWriteRow_(cfg, 'Accounts', { id, label: id + ' label', kind, campus, active: 'true' }));
    ['HP665805', 'HP660001'].forEach((reg) => h.ctx.officeWriteRow_(cfg, 'Vehicles', { reg, label: reg, kind: 'bus', campus: 'LMS1', active: 'true' }));
    ['LMS1', 'LMS2'].forEach((c) => h.ctx.officeWriteRow_(h.ctx.officeOpen_(c, '2026-27'), 'Files', { id: 'slip' + c, campus: c, drive_id: 'D', name: 's.jpg' }));
    return h;
  };
  let n = 0;
  const add = (h, o) => {
    const r = h.call('daybook.add', Object.assign({ id: 'e' + (++n), campus: 'LMS1', entry_date: '2026-10-10', account: 'cash:LMS1', direction: 'OUT', mode: 'cash', bucket: 'petty', category: 'stationery', amount_paise: 100 }, o), 'owner-token');
    assert.equal(r.success, true, JSON.stringify(r));
    return r.id;
  };
  const fuel = (h, o) => add(h, Object.assign({ account: 'pump1', mode: '', bucket: '', category: 'fuel', vehicle: 'HP665805', litres_ml: 40000, odometer_km: 1000, file_id: 'slipLMS1' }, o));
  const settle = (h, o) => add(h, Object.assign({ account: 'sbi1', mode: 'bank', bucket: '', category: 'credit_settlement', settles_account: 'pump1' }, o));
  const sum = (h, o, tok) => h.call('ledger.summary', Object.assign({ campus: 'LMS1', from: '2026-04-01', to: '2026-10-21' }, o), tok || 'owner-token');
  const acct = (s, id) => s.accounts.find((a) => a.id === id);

  t.test('Review Focus 3: credit fuel 5000 then bank settlement 5000 -> fuel -5000 once, owed 0, bank -5000', () => {
    const h = fresh();
    fuel(h, { amount_paise: 5000, entry_date: '2026-10-05' });
    let s = sum(h);
    assert.equal(s.success, true, JSON.stringify(s));
    assert.equal(acct(s, 'pump1').owed_paise, 5000, 'owed before settlement');
    settle(h, { amount_paise: 5000, entry_date: '2026-10-15' });
    s = sum(h);
    assert.deepEqual(J(s.byChargedTo), { LMS1: { fuel: -5000 } }, 'settlement is a movement, never an expense');
    assert.deepEqual(J(s.vehicles), { HP665805: { fuel: -5000 } });
    assert.equal(acct(s, 'pump1').owed_paise, 0);
    assert.equal(acct(s, 'sbi1').balance_paise, -5000);
    assert.equal(acct(s, 'cash:LMS1').balance_paise, 0);
    assert.deepEqual(J(acct(s, 'pump1')), { id: 'pump1', label: 'pump1 label', kind: 'credit', campus: 'LMS1', owed_paise: 0, balance_paise: 0 });
  });

  t.test('owed reads settlements from every campus book (P10b): LMS1 bank settles the LMS2 pump', () => {
    const h = fresh();
    fuel(h, { campus: 'LMS2', account: 'pump2', amount_paise: 3000, file_id: 'slipLMS2' });
    assert.equal(acct(sum(h, { campus: 'LMS2' }), 'pump2').owed_paise, 3000);
    settle(h, { settles_account: 'pump2', amount_paise: 1200 });
    const s2 = sum(h, { campus: 'LMS2' });
    assert.equal(acct(s2, 'pump2').owed_paise, 1800);
    assert.equal(acct(s2, 'sbi1'), undefined, 'only the campus\'s own accounts are listed');
    assert.equal(acct(sum(h), 'sbi1').balance_paise, -1200);
  });

  t.test('owed and balances start from the account openings; cash = opening + in - out with buckets', () => {
    const h = fresh();
    h.call('opening.set', { id: 'o', campus: 'LMS1', balances: [{ mode: 'cash', bucket: 'fee', amount_paise: 1000 }, { mode: 'cash', bucket: 'petty', amount_paise: 50 }, { mode: 'bank', amount_paise: 7000 }, { mode: 'upi', amount_paise: 3 }] }, 'owner-token');
    assert.equal(h.call('account.opening', { id: 'ao1', campus: 'LMS1', account: 'pump1', amount_paise: 900 }, 'owner-token').success, true);
    assert.equal(h.call('account.opening', { id: 'ao2', campus: 'LMS1', account: 'sbi1', amount_paise: 400 }, 'owner-token').success, true);
    add(h, { direction: 'IN', bucket: 'fee', category: 'fee_collection', amount_paise: 250 });
    add(h, { amount_paise: 20 });
    add(h, { account: 'bank:LMS1', mode: 'upi', bucket: '', direction: 'IN', category: 'fee_online', amount_paise: 11 });
    fuel(h, { amount_paise: 100 });
    settle(h, { amount_paise: 600 });
    const s = sum(h);
    assert.deepEqual(J(acct(s, 'cash:LMS1')), { id: 'cash:LMS1', label: 'LMS1 cash', kind: 'cash', campus: 'LMS1', balance_paise: 1280, buckets: { petty: 30, fee: 1250, other: 0 } });
    assert.equal(acct(s, 'bank:LMS1').balance_paise, 7014, 'default bank opening = campus bank + upi opening');
    assert.equal(acct(s, 'sbi1').balance_paise, -200);
    assert.equal(acct(s, 'pump1').owed_paise, 400);
    assert.deepEqual(s.accounts.map((a) => a.id).sort(), ['bank:LMS1', 'cash:LMS1', 'pump1', 'sbi1']);
  });

  t.test('LMS1 cash charged to HES lands in byChargedTo.HES and interSchool; a reversed entry nets to zero', () => {
    const h = fresh();
    add(h, { charged_to: 'HES', amount_paise: 700 });
    add(h, { charged_to: 'HES', amount_paise: 50, category: 'utilities' });
    const r = add(h, { charged_to: 'LMS2', amount_paise: 300, entry_date: '2026-10-21' });
    assert.equal(h.call('daybook.reverse', { id: 'rv', campus: 'LMS1', reverses: r }, 'owner-token').success, true);
    add(h, { direction: 'IN', bucket: 'fee', category: 'fee_collection', amount_paise: 999 });
    const s = sum(h);
    assert.deepEqual(J(s.byChargedTo), { HES: { stationery: -700, utilities: -50 }, LMS2: { stationery: 0 }, LMS1: { fee_collection: 999 } });
    assert.deepEqual(J(s.interSchool), [{ from: 'LMS1', to: 'HES', paise: 750 }], 'fully reversed LMS2 entry drops out');
    assert.equal(acct(s, 'cash:LMS1').balance_paise, 999 - 750);
  });

  t.test('period: from..to filters byChargedTo/interSchool/vehicles/fuel; balances and owed are as at to', () => {
    const h = fresh();
    fuel(h, { amount_paise: 100, entry_date: '2026-09-01', odometer_km: 500 });
    fuel(h, { amount_paise: 200, entry_date: '2026-10-05' });
    fuel(h, { amount_paise: 400, entry_date: '2026-10-20', odometer_km: 2000 });
    add(h, { charged_to: 'HES', amount_paise: 10, entry_date: '2026-09-01' });
    const s = sum(h, { from: '2026-10-01', to: '2026-10-10' });
    assert.deepEqual(J(s.byChargedTo), { LMS1: { fuel: -200 } });
    assert.deepEqual(J(s.interSchool), []);
    assert.deepEqual(J(s.vehicles), { HP665805: { fuel: -200 } });
    assert.equal(s.fuel.HP665805.length, 1);
    assert.equal(acct(s, 'pump1').owed_paise, 300, 'everything up to to, from the opening');
    assert.equal(acct(s, 'cash:LMS1').balance_paise, -10);
  });

  t.test('vehicles sum by pnl_column (income positive); fuel lists fills with km per litre from the previous fill', () => {
    const h = fresh();
    fuel(h, { id: 'f1', entry_date: '2026-10-01', odometer_km: 1000, litres_ml: 40000, amount_paise: 4000 });
    fuel(h, { id: 'f2', entry_date: '2026-10-03', odometer_km: 1400, litres_ml: 30000, amount_paise: 3000 });
    fuel(h, { id: 'bad', entry_date: '2026-10-03', odometer_km: 9999, litres_ml: 1000, amount_paise: 77 });
    assert.equal(h.call('daybook.reverse', { id: 'badrev', campus: 'LMS1', reverses: 'bad' }, 'owner-token').success, true);
    fuel(h, { id: 'f3', entry_date: '2026-10-08', odometer_km: 1777, litres_ml: 25500, amount_paise: 2500 });
    fuel(h, { id: 'g1', entry_date: '2026-10-02', vehicle: 'HP660001', odometer_km: 50, amount_paise: 1 });
    add(h, { account: 'pump1', mode: '', bucket: '', category: 'vehicle_service', vehicle: 'HP660001', amount_paise: 800 });
    add(h, { category: 'parking', vehicle: 'FLEET', amount_paise: 30 });
    add(h, { direction: 'IN', bucket: 'other', category: 'transport_income', vehicle: 'HP660001', amount_paise: 90 });
    const s = sum(h);
    assert.deepEqual(J(s.vehicles), { HP665805: { fuel: -9500 }, HP660001: { fuel: -1, service: -800, income: 90 }, FLEET: { parking: -30 } });
    assert.deepEqual(J(s.fuel.HP665805), [
      { id: 'f1', date: '2026-10-01', litres_ml: 40000, odometer_km: 1000, amount_paise: 4000, km_per_litre: null },
      { id: 'f2', date: '2026-10-03', litres_ml: 30000, odometer_km: 1400, amount_paise: 3000, km_per_litre: 10 },
      { id: 'f3', date: '2026-10-08', litres_ml: 25500, odometer_km: 1777, amount_paise: 2500, km_per_litre: 12.57 },
    ]);
    assert.equal(s.fuel.HP660001.length, 1);
    assert.equal(s.fuel.FLEET, undefined);
    assert.deepEqual(J(s.byChargedTo.LMS1), { fuel: -9501, vehicle_service: -800, parking: -30, transport_income: 90 });
  });

  t.test('ALL needs campuses ALL; campuses without a book are skipped; ALL sums every book', () => {
    const h = fresh();
    add(h, { amount_paise: 5 });
    add(h, { campus: 'LMS2', account: 'cash:LMS2', amount_paise: 7 });
    assert.equal(sum(h, { campus: 'ALL' }, 'pr1-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(sum(h, { campus: 'LMS2' }, 'pr1-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(sum(h, {}, 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.equal(sum(h, {}, 'pr1-token').success, true);
    const s = sum(h, { campus: 'ALL' }, 'co-token');
    assert.equal(s.success, true, JSON.stringify(s));
    assert.deepEqual(J(s.byChargedTo), { LMS1: { stationery: -5 }, LMS2: { stationery: -7 } });
    assert.deepEqual(s.accounts.map((a) => a.campus).filter((c, i, a) => a.indexOf(c) === i).sort(), ['LMS1', 'LMS2']);
    assert.equal(sum(h, { campus: 'all' }, 'fh-token').success, true, 'campus is canonicalised');
  });

  t.test('dates: one financial year, from <= to, real dates', () => {
    const h = fresh();
    assert.equal(sum(h, { from: '2026-03-31' }).error, 'RANGE_SPANS_YEARS');
    assert.equal(sum(h, { from: '2026-10-21', to: '2026-10-01' }).error, 'BAD_RANGE');
    assert.equal(sum(h, { from: '2026-02-30' }).error, 'BAD_DATE');
    assert.equal(sum(h, { to: '' }).error, 'BAD_DATE');
    assert.equal(sum(h, { campus: 'LMS3' }).error, 'NO_BOOK');
  });
};
