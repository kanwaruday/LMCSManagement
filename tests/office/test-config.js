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

  t.test('config.get returns seeded categories', () => {
    const h = fresh();
    const r = h.call('config.get', {}, 'clerk-token');
    assert.equal(r.success, true);
    assert.deepEqual(r.categories.map((c) => c.id), ['fee_collection', 'deposit_cash_out', 'deposit_bank_in', 'petty_expense', 'bill_payment', 'donation', 'other_in', 'other_out']);
    assert.equal(r.categories[0].direction, 'IN'); assert.equal(r.categories[1].direction, 'OUT');
    assert.deepEqual(J(r.limits), { AdminManager: 0, FinanceHead: 0, Principal: 0 });
    assert.deepEqual(r.campuses, ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES']);
    assert.equal(h.call('config.get', {}, 'clerk-token').categories.length, 8, 'second open does not reseed');
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
};
