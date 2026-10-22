// Config, categories and opening balances (apps-script/office-config.gs).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['fh@example.org', 'Finance Head', 'LMS1,LMS2', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
  ],
};
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig();
    h.addBook('LMS1', '2026-27');
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    return h;
  };
  const bal = [{ mode: 'cash', bucket: 'petty', amount_paise: 500000 }, { mode: 'cash', bucket: 'fee', amount_paise: 1200 }, { mode: 'bank', bucket: '', amount_paise: 9000000 }, { mode: 'upi', bucket: '', amount_paise: 77 }];

  t.test('config.get returns code categories, default accounts, vehicles, limits, campuses', () => {
    const h = fresh();
    const r = h.call('config.get', {}, 'clerk-token');
    assert.equal(r.success, true);
    const ids = r.categories.map((c) => c.id);
    for (const id of ['fee_collection', 'deposit_cash_out', 'deposit_bank_in', 'petty_expense', 'bill_payment', 'donation', 'other_in', 'other_out', 'fee_online', 'fuel', 'challan', 'credit_settlement', 'cash_transfer', 'chairman_personal']) assert.ok(ids.includes(id), id);
    assert.equal(new Set(ids).size, ids.length);
    const by = (id) => r.categories.find((c) => c.id === id);
    assert.deepEqual(J(by('fee_collection')), { id: 'fee_collection', label: 'Fee cash', direction: 'IN', group: 'fee', needs_vehicle: false, pnl_column: '', active: true });
    assert.equal(by('deposit_cash_out').active, false); assert.equal(by('deposit_cash_out').group, 'movement');
    assert.equal(by('petty_expense').active, false); assert.equal(by('fee_cheque').active, false);
    assert.equal(by('fuel').label, 'Fuel (diesel/petrol)'); assert.equal(by('fuel').needs_vehicle, true); assert.equal(by('fuel').pnl_column, 'fuel');
    assert.equal(by('transport_income').direction, 'IN'); assert.equal(by('transport_income').pnl_column, 'income');
    for (const c of r.categories) {
      assert.ok(['fee', 'income', 'school', 'transport', 'movement'].includes(c.group), c.id);
      assert.equal(c.needs_vehicle, c.group === 'transport' && c.id !== 'transport_legacy', c.id);
      if (c.needs_vehicle) assert.ok(['fuel', 'service', 'insurance', 'taxes', 'parking', 'challan', 'loan_interest', 'loan_principal', 'other', 'income'].includes(c.pnl_column), c.id);
    }
    assert.equal(r.accounts.length, 14); assert.deepEqual(J(r.accounts[0]), { id: 'cash:LMS1', label: 'LMS1 cash', kind: 'cash', campus: 'LMS1', active: true });
    assert.equal(r.accounts[13].id, 'bank:HES');
    assert.deepEqual(r.vehicles, []);
    assert.deepEqual(J(r.limits), { AdminManager: 0, FinanceHead: 0, Principal: 0 });
    assert.deepEqual(r.campuses, ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES']);
    assert.equal(h.ctx.officeCategory_('nope'), null); assert.equal(h.ctx.officeCategory_('fuel').id, 'fuel');
  });

  t.test('v13 categories: construction, collection paid onward, cash received, legacy and import adjustments', () => {
    const h = fresh();
    const by = (id) => h.call('config.get', {}, 'clerk-token').categories.find((c) => c.id === id);
    assert.deepEqual(J(by('construction_works')), { id: 'construction_works', label: 'Construction and building works', direction: 'OUT', group: 'school', needs_vehicle: false, pnl_column: '', active: true });
    assert.deepEqual([by('student_collection_paid').direction, by('student_collection_paid').group, by('student_collection_paid').active], ['OUT', 'school', true]);
    assert.deepEqual([by('cash_received').direction, by('cash_received').group, by('cash_received').active], ['IN', 'movement', true]);
    assert.deepEqual([by('transport_legacy').group, by('transport_legacy').needs_vehicle, by('transport_legacy').pnl_column, by('transport_legacy').active], ['transport', false, '', false]);
    assert.deepEqual([by('import_adjustment_in').direction, by('import_adjustment_in').active, by('import_adjustment_out').direction, by('import_adjustment_out').active], ['IN', false, 'OUT', false]);
    assert.equal(by('chairman_personal').label, 'Personal (Chairman and family)');
  });

  t.test('officeNormReg_ strips spaces, dots and dashes and upper-cases', () => {
    const h = fresh();
    assert.equal(h.ctx.officeNormReg_('hp 66-5805'), 'HP665805'); assert.equal(h.ctx.officeNormReg_('hp.12.a-1 2'), 'HP12A12');
  });

  t.test('account.add: roles, codes, stored, audited, retry is a no-op, defaults reserved', () => {
    const h = fresh(); h.addBook('LMS2', '2026-27');
    const acc = { id: 'a1', label: 'Pump X (LMS1)', kind: 'credit', campus: 'LMS1' };
    assert.equal(h.call('account.add', acc, 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('account.add', Object.assign({}, acc, { kind: 'cash' }), 'fh-token').error, 'BAD_KIND');
    assert.equal(h.call('account.add', Object.assign({}, acc, { label: '  ' }), 'fh-token').error, 'LABEL_REQUIRED');
    assert.equal(h.call('account.add', Object.assign({}, acc, { id: 'cash:LMS1' }), 'fh-token').error, 'BAD_ID');
    assert.equal(h.call('account.add', Object.assign({}, acc, { campus: 'LMS3' }), 'fh-token').error, 'FORBIDDEN_CAMPUS');
    let r = h.call('account.add', acc, 'fh-token');
    assert.equal(r.success, true); assert.equal(r.duplicate, false);
    assert.equal(h.call('account.add', acc, 'fh-token').duplicate, true);
    const g = h.call('config.get', {}, 'clerk-token');
    assert.equal(g.accounts.length, 15);
    assert.deepEqual(J(g.accounts[14]), { id: 'a1', label: 'Pump X (LMS1)', kind: 'credit', campus: 'LMS1', active: true });
    assert.deepEqual(J(h.ctx.officeAccount_('a1')), J(g.accounts[14])); assert.equal(h.ctx.officeAccount_('zzz'), null);
    const au = h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Audit');
    assert.equal(au.length, 1); assert.equal(au[0].action, 'account.add'); assert.equal(au[0].tab, 'Accounts');
    assert.equal(h.call('account.add', { id: 'a2', label: 'HDFC', kind: 'bank', campus: 'LMS2' }, 'owner-token').success, true);
  });

  t.test('vehicle.add and vehicles.import normalise reg, skip existing, validate first', () => {
    const h = fresh();
    const v = { reg: 'hp 66-5805', label: 'Bus 1', kind: 'bus', campus: 'LMS1' };
    assert.equal(h.call('vehicle.add', v, 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('vehicle.add', Object.assign({}, v, { kind: 'tank' }), 'fh-token').error, 'BAD_KIND');
    assert.equal(h.call('vehicle.add', Object.assign({}, v, { reg: ' - ' }), 'fh-token').error, 'MISSING_REG');
    assert.equal(h.call('vehicle.add', v, 'fh-token').duplicate, false);
    assert.equal(h.call('vehicle.add', Object.assign({}, v, { reg: 'HP-66.5805' }), 'fh-token').duplicate, true);
    let r = h.call('vehicles.import', { vehicles: [{ reg: 'HP 66 5805', label: 'x', kind: 'bus', campus: 'LMS1' }, { reg: 'hp-01-1', label: 'Jeep', kind: 'jeep', campus: 'LMS1' }, { reg: 'HP011', kind: 'jeep', campus: 'LMS1' }] }, 'fh-token');
    assert.equal(r.added, 1);
    assert.equal(h.call('vehicles.import', { vehicles: [{ reg: 'A1', kind: 'car', campus: 'LMS1' }, { reg: 'B2', kind: 'plane', campus: 'LMS1' }] }, 'fh-token').error, 'BAD_KIND');
    assert.equal(h.call('vehicles.import', { vehicles: [{ reg: 'C3', kind: 'car', campus: 'LMS3' }] }, 'fh-token').error, 'FORBIDDEN_CAMPUS');
    assert.deepEqual(h.call('config.get', {}, 'fh-token').vehicles.map((x) => [x.reg, x.kind, x.active]), [['HP665805', 'bus', true], ['HP011', 'jeep', true]]);
    assert.equal(h.ctx.officeVehicles_()[0].label, 'Bus 1');
  });

  t.test('account.opening: once per bank/credit account, row has account and mode, cash refused', () => {
    const h = fresh();
    h.call('account.add', { id: 'a1', label: 'Pump', kind: 'credit', campus: 'LMS1' }, 'fh-token');
    const op = { id: 'ao1', campus: 'LMS1', account: 'a1', amount_paise: 12345 };
    assert.equal(h.call('account.opening', op, 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('account.opening', Object.assign({}, op, { account: 'cash:LMS1' }), 'fh-token').error, 'BAD_KIND');
    assert.equal(h.call('account.opening', Object.assign({}, op, { account: 'nope' }), 'fh-token').error, 'UNKNOWN_ACCOUNT');
    assert.equal(h.call('account.opening', Object.assign({}, op, { amount_paise: -1 }), 'fh-token').error, 'BAD_AMOUNT');
    assert.equal(h.call('account.opening', Object.assign({}, op, { amount_paise: 1.5 }), 'fh-token').error, 'BAD_AMOUNT');
    assert.equal(h.call('account.opening', op, 'fh-token').duplicate, false);
    assert.equal(h.call('account.opening', op, 'fh-token').duplicate, true, 'same id retries');
    const r = h.call('account.opening', Object.assign({}, op, { id: 'ao2' }), 'fh-token');
    assert.equal(r.error, 'ACCOUNT_OPENING_EXISTS'); assert.equal(r.code, 'ACCOUNT_OPENING_EXISTS');
    const ss = h.ctx.officeOpen_('LMS1', '2026-27');
    const rows = h.ctx.officeRows_(ss, 'Opening');
    assert.equal(rows.length, 1); assert.deepEqual([rows[0].account, rows[0].mode, rows[0].bucket, rows[0].amount_paise], ['a1', 'credit', '', 12345]);
    h.call('account.add', { id: 'b1', label: 'HDFC', kind: 'bank', campus: 'LMS1' }, 'fh-token');
    assert.equal(h.call('account.opening', { id: 'ao3', campus: 'LMS1', account: 'bank:LMS1', amount_paise: 0 }, 'fh-token').success, true);
    assert.equal(h.ctx.officeRows_(ss, 'Opening')[1].mode, 'bank');
    assert.deepEqual(J(h.ctx.officeOpening_(ss)), { cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 }, 'campus opening ignores account rows');
  });

  t.test('a new tab with more columns than the sheet grid is widened (P7)', () => {
    const h = boot(fixture); h.addBook('LMS1', '2026-27');
    h.run("OFFICE_TABLES.Wide = Array.from({length: 30}, function (_, i) { return 'c' + i; })");
    const ss = h.ctx.officeOpen_('LMS1', '2026-27'); const sh = ss.getSheetByName('Wide');
    assert.equal(sh.values[0].length, 30); assert.ok(sh.maxCols >= 30); assert.equal(sh.insertCalls, 1);
    assert.equal(ss.getSheetByName('Audit').insertCalls, 0);
  });

  t.test('opening.set by FeeClerk refused', () => {
    const h = fresh();
    assert.equal(h.call('opening.set', { id: 'o1', campus: 'LMS1', balances: bal }, 'clerk-token').error, 'FORBIDDEN_ROLE');
  });

  t.test('opening.set by FinanceHead stores balances and audits', () => {
    const h = fresh();
    const r = h.call('opening.set', { id: 'o1', campus: 'lms1', balances: bal }, 'fh-token');
    assert.equal(r.success, true);
    assert.deepEqual(J(r.opening), { cash: { petty: 500000, fee: 1200, other: 0 }, bank: 9000000, upi: 77 });
    const ss = h.ctx.officeOpen_('LMS1', '2026-27');
    assert.deepEqual(h.ctx.officeRows_(ss, 'Opening').map((x) => x.id), ['o1:0', 'o1:1', 'o1:2', 'o1:3']);
    const a = h.ctx.officeRows_(ss, 'Audit');
    assert.equal(a.length, 4); assert.equal(a[0].action, 'opening.set'); assert.equal(a[0].who, 'fh@example.org');
    h.call('opening.set', { id: 'o1', campus: 'LMS1', balances: bal }, 'fh-token');
    assert.equal(h.ctx.officeRows_(ss, 'Opening').length, 4, 'retry is idempotent');
    h.call('opening.set', { id: 'o2', campus: 'LMS1', balances: [{ mode: 'bank', bucket: '', amount_paise: 5 }] }, 'owner-token');
    assert.equal(h.ctx.officeOpening_(ss).bank, 5, 'latest row wins');
    assert.equal(h.ctx.officeOpening_(ss).upi, 77);
  });

  t.test('opening.set after first daybook row returns OPENING_LOCKED', () => {
    const h = fresh();
    const ss = h.ctx.officeOpen_('LMS1', '2026-27');
    h.ctx.officeAppend_(ss, 'DayBook', { id: 'd1', campus: 'LMS1', entry_date: '2026-10-21', direction: 'IN', amount_paise: 100 }, { email: 'clerk@example.org' }, {});
    const r = h.call('opening.set', { id: 'o1', campus: 'LMS1', balances: bal }, 'fh-token');
    assert.equal(r.success, false); assert.equal(r.error, 'OPENING_LOCKED');
    assert.equal(h.ctx.officeRows_(ss, 'Opening').length, 0);
  });

  t.test('bucket is required when mode is cash', () => {
    const h = fresh();
    const r = h.call('opening.set', { id: 'o1', campus: 'LMS1', balances: [{ mode: 'cash', bucket: '', amount_paise: 100 }] }, 'fh-token');
    assert.equal(r.error, 'BUCKET_REQUIRED');
    assert.equal(h.call('opening.set', { id: 'o1', campus: 'LMS1', balances: [{ mode: 'bank', bucket: '', amount_paise: 1.5 }] }, 'fh-token').error, 'BAD_AMOUNT');
  });

  t.test('officeOpening_ is all zero for an empty book', () => {
    const h = fresh();
    assert.deepEqual(J(h.ctx.officeOpening_(h.ctx.officeOpen_('LMS1', '2026-27'))), { cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 });
  });

  t.test('one request checks the Config headers once, on Accounts and Vehicles only', () => {
    const h = fresh();
    h.call('config.get', {}, 'clerk-token'); // creates the tabs
    const real = h.ctx.officeEnsureHeader_, seen = [];
    h.ctx.officeEnsureHeader_ = (sheet, cols) => { seen.push(sheet.getName()); return real(sheet, cols); };
    assert.equal(h.call('config.get', {}, 'clerk-token').success, true);
    assert.deepEqual(seen.slice().sort(), ['Accounts', 'Vehicles']);
  });
};
