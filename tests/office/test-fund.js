// Bank-to-bank fund transfers between campuses (fund.transfer in apps-script/office-deposits.gs). Synthetic data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org', 'acc-token': 'acc@example.org', 'fh1-token': 'fh1@example.org', 'coord-token': 'coord@example.org', 'fh2-token': 'fh2@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
    ['acc@example.org', 'Accounts', 'LMS1', 'Accounts'],
    ['fh1@example.org', 'Finance Head LMS1', 'LMS1', 'FinanceHead'],
    ['coord@example.org', 'Coordinator', 'ALL', 'Coordinator,Accounts'],
    ['fh2@example.org', 'Other Finance Head', 'ALL', 'FinanceHead'],
  ],
};
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig();
    ['LMS1', 'LMS2', 'HES'].forEach((c) => h.addBook(c, '2026-27'));
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    const cfg = h.ctx.officeConfigBook_();
    [['sbi-hes', 'bank', 'HES', 'true'], ['hdfc-lms1', 'bank', 'LMS1', 'true'], ['old-lms2', 'bank', 'LMS2', 'false'], ['pump1', 'credit', 'LMS1', 'true']]
      .forEach(([id, kind, campus, active]) => h.ctx.officeWriteRow_(cfg, 'Accounts', { id, label: id, kind, campus, active }));
    h.ctx.officeWriteRow_(cfg, 'Settings', { key: 'fund_transfer_emails', value: 'nobody@example.org' });
    h.ctx.officeWriteRow_(cfg, 'Settings', { key: 'fund_transfer_emails', value: 'FH@example.org, acc@example.org,fh1@example.org' }); // latest row wins
    return h;
  };
  const xfer = (h, o, tok) => h.call('fund.transfer', Object.assign({ id: 't1', date: '2026-10-20', from_account: 'bank:LMS1', to_account: 'sbi-hes', amount_paise: 500000, reference: 'UTR123' }, o), tok || 'fh-token');
  const rows = (h, c) => h.ctx.officeRows_(h.ctx.officeOpen_(c, '2026-27'), 'DayBook');
  const bank = (h, c, date) => h.call('daybook.balances', { campus: c, date: date || '2026-10-21' }, 'owner-token').closing;

  t.test('fund.transfer writes an OUT leg in the from book and an IN leg in the to book, linked', () => {
    const h = fresh();
    const r = xfer(h, { narration: 'Salary float' });
    assert.equal(r.success, true); assert.equal(r.duplicate, false);
    const pick = (x) => [x.id, x.campus, x.entry_date, x.direction, x.mode, x.bucket, x.category, x.amount_paise, x.account, x.charged_to, x.settles, x.payee, x.narration];
    assert.deepEqual(rows(h, 'LMS1').map(pick), [['t1-out', 'LMS1', '2026-10-20', 'OUT', 'bank', '', 'fund_transfer_out', 500000, 'bank:LMS1', 'LMS1', 't1-in', 'sbi-hes', 'Fund transfer UTR123: Salary float']]);
    assert.deepEqual(rows(h, 'HES').map(pick), [['t1-in', 'HES', '2026-10-20', 'IN', 'bank', '', 'fund_transfer_in', 500000, 'sbi-hes', 'HES', 't1-out', 'bank:LMS1', 'Fund transfer UTR123: Salary float']]);
  });

  t.test('retry is a duplicate and writes nothing; a missing leg is repaired', () => {
    const h = fresh();
    xfer(h);
    assert.equal(xfer(h).duplicate, true);
    assert.equal(rows(h, 'LMS1').length + rows(h, 'HES').length, 2);
    const sh = h.ctx.officeOpen_('HES', '2026-27').getSheetByName('DayBook');
    sh.deleteRow(sh.getDataRange().getValues().findIndex((r) => r[0] === 't1-in') + 1);
    assert.equal(rows(h, 'HES').length, 0);
    const r = xfer(h);
    assert.equal(r.success, true); assert.equal(r.duplicate, true);
    assert.deepEqual(rows(h, 'HES').map((x) => x.id), ['t1-in']);
    assert.equal(rows(h, 'LMS1').length, 1);
  });

  t.test('refusals: same campus, non-bank, inactive, unknown, reference, amount, date', () => {
    const h = fresh();
    assert.equal(xfer(h, { to_account: 'hdfc-lms1' }).code, 'FUND_SAME_CAMPUS');
    assert.equal(xfer(h, { from_account: 'cash:LMS1' }).error, 'BAD_ACCOUNT');
    assert.equal(xfer(h, { to_account: 'pump1' }).error, 'BAD_ACCOUNT');
    assert.equal(xfer(h, { to_account: 'old-lms2' }).error, 'BAD_ACCOUNT');
    assert.equal(xfer(h, { to_account: 'nope' }).error, 'BAD_ACCOUNT');
    assert.equal(xfer(h, { reference: '  ' }).error, 'BANK_REF_REQUIRED');
    assert.equal(xfer(h, { amount_paise: 0 }).error, 'BAD_AMOUNT');
    assert.equal(xfer(h, { amount_paise: '5000' }).error, 'BAD_AMOUNT');
    assert.equal(xfer(h, { date: '2026-10-22' }).error, 'FUTURE_DATE');
    assert.equal(xfer(h, { date: '2026-02-30' }).error, 'BAD_DATE');
    assert.equal(rows(h, 'LMS1').length + rows(h, 'HES').length, 0);
  });

  t.test('roles: clerk refused; Accounts (FinanceHead on ALL) and Owner allowed; FinanceHead needs both campuses', () => {
    const h = fresh();
    assert.equal(xfer(h, {}, 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.equal(xfer(h, {}, 'fh1-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(xfer(h, {}, 'acc-token').success, true);
    assert.equal(xfer(h, { id: 't2', from_account: 'sbi-hes', to_account: 'bank:LMS2' }, 'owner-token').success, true);
  });

  t.test('only the Owner and the emails in Settings fund_transfer_emails may transfer; config.get says so', () => {
    const h = fresh();
    assert.equal(xfer(h, {}, 'coord-token').error, 'FORBIDDEN_ROLE');
    assert.equal(xfer(h, {}, 'fh2-token').error, 'FORBIDDEN_ROLE');
    assert.equal(rows(h, 'LMS1').length, 0);
    const flag = (tok) => h.call('config.get', {}, tok).fund_transfer_allowed;
    assert.deepEqual(['fh-token', 'owner-token', 'coord-token', 'fh2-token', 'clerk-token'].map(flag), [true, true, false, false, false]);
    xfer(h);
    assert.equal(h.call('daybook.reverse', { id: 'rv', campus: 'LMS1', reverses: 't1-out' }, 'fh2-token').error, 'FORBIDDEN_ROLE', 'reversal follows the same rule');
  });

  t.test('balances move bank on both sides, cash untouched', () => {
    const h = fresh();
    xfer(h);
    const a = bank(h, 'LMS1'), b = bank(h, 'HES');
    assert.equal(a.bank, -500000); assert.equal(b.bank, 500000);
    assert.deepEqual(J(a.cash), { petty: 0, fee: 0, other: 0 }); assert.deepEqual(J(b.cash), { petty: 0, fee: 0, other: 0 });
  });

  t.test('ledger.summary: neither leg is income or cost; interSchool shows from -> to; account balances move', () => {
    const h = fresh();
    xfer(h);
    const s = h.call('ledger.summary', { campus: 'ALL', from: '2026-04-01', to: '2026-10-21' }, 'owner-token');
    assert.deepEqual(J(s.byChargedTo), {});
    assert.deepEqual(J(s.interSchool), [{ from: 'LMS1', to: 'HES', paise: 500000 }]);
    const bal = (id) => s.accounts.find((a) => a.id === id).balance_paise;
    assert.equal(bal('bank:LMS1'), -500000); assert.equal(bal('sbi-hes'), 500000); assert.equal(bal('cash:LMS1'), 0);
  });

  t.test('daybook.reverse of either leg reverses both, each in its own book; retry writes nothing', () => {
    const h = fresh();
    xfer(h);
    assert.equal(h.call('daybook.reverse', { id: 'rv1', campus: 'LMS1', reverses: 't1-out' }, 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('daybook.reverse', { id: 'rv1', campus: 'HES', reverses: 't1-in' }, 'fh1-token').error, 'FORBIDDEN_CAMPUS');
    const r = h.call('daybook.reverse', { id: 'rv1', campus: 'HES', reverses: 't1-in' }, 'fh-token');
    assert.equal(r.success, true);
    const pick = (x) => [x.id, x.entry_date, x.direction, x.category, x.account, x.reverses, x.amount_paise];
    assert.deepEqual(rows(h, 'LMS1').slice(1).map(pick), [['t1-out-rv', '2026-10-21', 'IN', 'fund_transfer_out', 'bank:LMS1', 't1-out', 500000]]);
    assert.deepEqual(rows(h, 'HES').slice(1).map(pick), [['t1-in-rv', '2026-10-21', 'OUT', 'fund_transfer_in', 'sbi-hes', 't1-in', 500000]]);
    assert.equal(h.call('daybook.reverse', { id: 'rv1', campus: 'HES', reverses: 't1-in' }, 'fh-token').duplicate, true);
    assert.equal(h.call('daybook.reverse', { id: 'rv2', campus: 'LMS1', reverses: 't1-out' }, 'fh-token').duplicate, true, 'the other leg is already reversed');
    assert.equal(rows(h, 'LMS1').length + rows(h, 'HES').length, 4);
    assert.equal(h.call('daybook.reverse', { id: 'rv3', campus: 'LMS1', reverses: 't1-out-rv' }, 'fh-token').code, 'FUND_LEG');
    assert.equal(bank(h, 'LMS1').bank, 0); assert.equal(bank(h, 'HES').bank, 0);
    const s = h.call('ledger.summary', { campus: 'ALL', from: '2026-04-01', to: '2026-10-21' }, 'owner-token');
    assert.deepEqual(J(s.interSchool), []);
  });

  t.test('reversal repairs a missing reversal leg; a transfer missing a leg is not reversed', () => {
    const h = fresh();
    xfer(h);
    h.call('daybook.reverse', { id: 'rv1', campus: 'LMS1', reverses: 't1-out' }, 'fh-token');
    const sh = h.ctx.officeOpen_('HES', '2026-27').getSheetByName('DayBook');
    sh.deleteRow(sh.getDataRange().getValues().findIndex((r) => r[0] === 't1-in-rv') + 1);
    assert.equal(h.call('daybook.reverse', { id: 'rv1', campus: 'LMS1', reverses: 't1-out' }, 'fh-token').duplicate, true);
    assert.deepEqual(rows(h, 'HES').map((x) => x.id), ['t1-in', 't1-in-rv']);
    xfer(h, { id: 't9' });
    sh.deleteRow(sh.getDataRange().getValues().findIndex((r) => r[0] === 't9-in') + 1);
    assert.equal(h.call('daybook.reverse', { id: 'rv9', campus: 'LMS1', reverses: 't9-out' }, 'fh-token').code, 'FUND_INCOMPLETE');
  });

  t.test('reversal retry across 1 April writes only the missing reversal, never a second one', () => {
    const h = fresh();
    h.setNow(new Date('2027-03-31T06:00:00Z'));
    xfer(h, { date: '2027-03-31' });
    h.call('daybook.reverse', { id: 'rv', campus: 'LMS1', reverses: 't1-out' }, 'fh-token');
    const sh = h.ctx.officeOpen_('HES', '2026-27').getSheetByName('DayBook');
    sh.deleteRow(sh.getDataRange().getValues().findIndex((r) => r[0] === 't1-in-rv') + 1);
    ['LMS1', 'HES'].forEach((c) => h.addBook(c, '2027-28'));
    h.setNow(new Date('2027-04-01T06:00:00Z'));
    assert.equal(h.call('daybook.reverse', { id: 'rv', campus: 'LMS1', reverses: 't1-out' }, 'fh-token').success, true);
    const ids = (c, fy) => h.ctx.officeRows_(h.ctx.officeOpen_(c, fy), 'DayBook').map((x) => x.id);
    assert.deepEqual(ids('LMS1', '2027-28'), [], 'the LMS1 reversal is already in last year\'s book');
    assert.deepEqual(ids('HES', '2027-28'), ['t1-in-rv']);
    assert.deepEqual(ids('LMS1', '2026-27'), ['t1-out', 't1-out-rv']);
  });

  t.test('fund categories are not offered on the Day Book form', () => {
    const h = fresh();
    const r = h.call('daybook.add', { id: 'x', campus: 'LMS1', entry_date: '2026-10-20', account: 'bank:LMS1', direction: 'IN', mode: 'bank', category: 'fund_transfer_in', amount_paise: 1 }, 'fh-token');
    assert.equal(r.error, 'CATEGORY_INACTIVE');
  });
};
