// Deposits, signing, ERP totals and reconciliation (apps-script/office-deposits.gs).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org', 'other-token': 'other@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
    ['other@example.org', 'Other Clerk', 'LMS2', 'FeeClerk'],
  ],
};
const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26');
    h.setNow(new Date('2026-10-21T10:00:00Z')); // 15:30 IST on 2026-10-21
    h.call('file.upload', { id: 'slip', campus: 'LMS1', category: 'deposit_proof', mime: 'application/pdf', base64: PDF, name: 's.pdf' }, 'clerk-token');
    return h;
  };
  let n = 0;
  const fee = (h, amt, date, o) => h.call('daybook.add', Object.assign({ id: 'f' + (++n), campus: 'LMS1', entry_date: date || '2026-10-20', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: amt }, o), 'clerk-token');
  const dep = (h, o, tok) => h.call('deposit.add', Object.assign({ id: 'd' + (++n), campus: 'LMS1', covers_date: '2026-10-20', amount_paise: 5000, bank_ref: 'CH-1', file_id: 'slip' }, o), tok || 'clerk-token');
  const recon = (h, date) => h.call('recon.get', { campus: 'LMS1', date: date || '2026-10-20' }, 'clerk-token');
  const rows = (h, tab) => h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), tab);

  t.test('deposit without file_id refused; unknown file is FILE_MISSING', () => {
    const h = fresh(); fee(h, 5000);
    const a = dep(h, { file_id: '' });
    assert.equal(a.success, false); assert.equal(a.code, 'FILE_REQUIRED');
    const b = dep(h, { file_id: 'nope' });
    assert.equal(b.code, 'FILE_MISSING');
    assert.equal(rows(h, 'Deposits').length, 0);
  });

  t.test('deposit creates both day-book legs and balances stay consistent', () => {
    const h = fresh(); fee(h, 8000);
    const r = dep(h, { id: 'dep1' });
    assert.equal(r.success, true);
    const e = h.call('daybook.list', { campus: 'LMS1', from: '2026-10-21' }, 'clerk-token').entries;
    assert.deepEqual(e.map((x) => [x.id, x.category, x.direction, x.mode, x.bucket, x.amount_paise, x.narration]), [
      ['dep1:out', 'deposit_cash_out', 'OUT', 'cash', 'fee', 5000, 'Deposit CH-1 for 2026-10-20'],
      ['dep1:in', 'deposit_bank_in', 'IN', 'bank', '', 5000, 'Deposit CH-1 for 2026-10-20'],
    ]);
    const b = h.call('daybook.balances', { campus: 'LMS1', date: '2026-10-21' }, 'clerk-token');
    assert.equal(b.closing.cash.fee, 3000); assert.equal(b.closing.bank, 5000);
    assert.equal(dep(h, { id: 'dep1' }).duplicate, true);
    assert.equal(rows(h, 'DayBook').length, 3, 'retry adds nothing');
  });

  t.test('validation: amount, bank_ref, dates, cash available', () => {
    const h = fresh(); fee(h, 5000);
    assert.equal(dep(h, { amount_paise: 0 }).error, 'BAD_AMOUNT');
    assert.equal(dep(h, { amount_paise: 10.5 }).error, 'BAD_AMOUNT');
    assert.equal(dep(h, { amount_paise: '50' }).error, 'BAD_AMOUNT');
    assert.equal(dep(h, { bank_ref: '  ' }).error, 'BANK_REF_REQUIRED');
    assert.equal(dep(h, { covers_date: '2026-10-22' }).error, 'FUTURE_DATE');
    assert.equal(dep(h, { covers_date: '2026-02-30' }).error, 'BAD_DATE');
    assert.equal(dep(h, { amount_paise: 5001 }).code, 'INSUFFICIENT_CASH');
    assert.equal(dep(h, { amount_paise: 5000 }).success, true);
    assert.equal(dep(h, { amount_paise: 1 }).code, 'INSUFFICIENT_CASH', 'cash already deposited');
  });

  t.test('covers_date may be a closed day only because the deposit itself lands today', () => {
    const h = fresh(); fee(h, 5000);
    assert.equal(h.call('day.close', { id: 'c1', campus: 'LMS1', close_date: '2026-10-20' }, 'fh-token').success, true);
    assert.equal(dep(h, { id: 'ok' }).success, true);
    // a deposit while today is closed is refused (closed after the fact via a test-side Closes row)
    h.ctx.officeAppend_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Closes', { id: 'cx', campus: 'LMS1', close_date: '2026-10-21', closing_json: '{}' }, { email: 'x' }, {});
    const r = dep(h, { id: 'no', amount_paise: 1 });
    assert.equal(r.code, 'DAY_CLOSED');
  });

  t.test('overdue false on D+1 23:59 IST and true after', () => {
    const h = fresh(); fee(h, 5000);
    h.setNow(new Date('2026-10-21T18:29:00Z')); // 23:59 IST on D+1
    assert.equal(recon(h).overdue, false);
    h.setNow(new Date('2026-10-21T18:30:00Z')); // 00:00 IST D+2
    assert.equal(recon(h).overdue, true);
  });

  t.test('partial deposit leaves overdue true with delta; full deposit clears it', () => {
    const h = fresh(); fee(h, 5000);
    dep(h, { id: 'p', amount_paise: 2000 });
    h.setNow(new Date('2026-10-22T18:30:00Z'));
    let r = recon(h);
    assert.equal(r.overdue, true); assert.equal(r.deposited, 2000); assert.equal(r.daybook_fee_cash, 5000);
    assert.deepEqual(r.differences, [{ a: 'daybook_fee_cash', b: 'deposited', delta_paise: 3000 }]);
    dep(h, { id: 'q', amount_paise: 3000 });
    r = recon(h);
    assert.equal(r.overdue, false); assert.deepEqual(r.differences, []);
  });

  t.test('reversed collection reduces day-book fee cash; non-cash and other dates ignored', () => {
    const h = fresh(); fee(h, 5000, '2026-10-20', { id: 'a' }); fee(h, 700, '2026-10-20', { id: 'b' });
    fee(h, 900, '2026-10-20', { mode: 'upi', bucket: undefined }); fee(h, 400, '2026-10-19');
    h.call('daybook.reverse', { id: 'rv', campus: 'LMS1', reverses: 'b' }, 'clerk-token');
    assert.equal(recon(h).daybook_fee_cash, 5000);
  });

  t.test('ERP total differing from day book fee cash is listed; latest per date wins', () => {
    const h = fresh(); fee(h, 5000);
    assert.equal(recon(h).erp, null);
    const set = (id, amt, tok) => h.call('erp.set', { id, campus: 'LMS1', total_date: '2026-10-20', amount_paise: amt }, tok || 'clerk-token');
    set('e1', 6000);
    h.setNow(new Date('2026-10-21T10:05:00Z'));
    assert.equal(set('e2', 0).success, true);
    assert.equal(recon(h).erp, 0);
    set('e3', 5500);
    assert.equal(set('e3', 1).duplicate, true);
    let r = recon(h);
    assert.equal(r.erp, 5500);
    assert.deepEqual(r.differences[0], { a: 'erp', b: 'daybook_fee_cash', delta_paise: 500 });
    set('e4', 5000);
    assert.deepEqual(recon(h).differences.filter((d) => d.a === 'erp'), []);
    assert.equal(set('e5', -1).error, 'BAD_AMOUNT');
    assert.equal(set('e6', 1.5).error, 'BAD_AMOUNT');
  });

  t.test('deposit.list returns amount, bank_ref, file_id; signed flips after deposit.sign; other campus refused', () => {
    const h = fresh(); fee(h, 9000); dep(h, { id: 'l1', amount_paise: 4000, bank_ref: 'R-7' }); dep(h, { id: 'l2', covers_date: '2026-10-19', amount_paise: 100 });
    const list = () => h.call('deposit.list', { campus: 'LMS1', covers_date: '2026-10-20' }, 'clerk-token');
    let r = list();
    assert.equal(r.success, true); assert.equal(r.deposits.length, 1);
    assert.deepEqual([r.deposits[0].id, r.deposits[0].amount_paise, r.deposits[0].bank_ref, r.deposits[0].file_id, r.deposits[0].signed, r.deposits[0].created_by], ['l1', 4000, 'R-7', 'slip', false, 'clerk@example.org']);
    h.call('deposit.sign', { id: 'ls', campus: 'LMS1', deposit_id: 'l1' }, 'fh-token');
    assert.equal(list().deposits[0].signed, true);
    assert.equal(h.call('deposit.list', { campus: 'LMS1', covers_date: '2026-10-20' }, 'other-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(recon(h).closed, false);
  });

  t.test('sign by clerk refused, by FinanceHead derives signed and audits; second sign is ALREADY_SIGNED', () => {
    const h = fresh(); fee(h, 5000); dep(h, { id: 'dx' });
    const sign = (id, tok) => h.call('deposit.sign', { id, campus: 'LMS1', deposit_id: 'dx' }, tok);
    assert.equal(sign('s0', 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.deepEqual(recon(h).unsigned, ['dx']);
    assert.equal(sign('s1', 'fh-token').success, true);
    const s = rows(h, 'DepositSigns');
    assert.equal(s.length, 1); assert.equal(s[0].created_by, 'fh@example.org'); assert.equal(s[0].deposit_id, 'dx');
    assert.ok(rows(h, 'Audit').some((a) => a.action === 'deposit.sign' && a.row_id === 's1'));
    assert.deepEqual(recon(h).unsigned, []);
    assert.equal(sign('s1', 'fh-token').duplicate, true);
    assert.equal(sign('s2', 'owner-token').code, 'ALREADY_SIGNED');
    assert.equal(h.call('deposit.sign', { id: 's3', campus: 'LMS1', deposit_id: 'ghost' }, 'fh-token').error, 'NOT_FOUND');
    assert.equal(rows(h, 'Deposits')[0].signed_by, undefined);
  });

  t.test('retry repairs a deposit whose legs were lost; closed day gives LEGS_MISSING; intact retry writes nothing', () => {
    const h = fresh(); fee(h, 8000);
    // crash after the Deposits row (no legs), and after :out only
    h.ctx.officeAppend_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Deposits', { id: 'c1', campus: 'LMS1', covers_date: '2026-10-20', amount_paise: 3000, bank_ref: 'R1', file_id: 'slip' }, { email: 'clerk@example.org' }, {});
    h.ctx.officeAppend_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Deposits', { id: 'c2', campus: 'LMS1', covers_date: '2026-10-20', amount_paise: 2000, bank_ref: 'R2', file_id: 'slip' }, { email: 'clerk@example.org' }, {});
    h.setNow(new Date('2026-10-21T10:30:00Z'));
    h.ctx.officeDaybookWrite_(h.ctx.officeOpen_('LMS1', '2026-27'), { caller: { email: 'x' } }, { id: 'c2:out', campus: 'LMS1', entry_date: '2026-10-21', direction: 'OUT', mode: 'cash', bucket: 'fee', category: 'deposit_cash_out', amount_paise: 2000 }, 'deposit.add');
    assert.equal(dep(h, { id: 'c1', amount_paise: 3000 }).duplicate, true);
    assert.equal(dep(h, { id: 'c2', amount_paise: 2000 }).duplicate, true);
    const ids = rows(h, 'DayBook').map((r) => r.id).filter((x) => /^c\d:/.test(x)).sort();
    assert.deepEqual(ids, ['c1:in', 'c1:out', 'c2:in', 'c2:out']);
    const b = h.call('daybook.balances', { campus: 'LMS1', date: '2026-10-21' }, 'clerk-token');
    assert.equal(b.closing.cash.fee, 3000); assert.equal(b.closing.bank, 5000);
    const before = rows(h, 'DayBook').length;
    assert.equal(dep(h, { id: 'c1' }).duplicate, true);
    assert.equal(rows(h, 'DayBook').length, before, 'intact retry writes nothing');
    // closed deposit day with a leg missing
    h.ctx.officeAppend_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Deposits', { id: 'c3', campus: 'LMS1', covers_date: '2026-10-20', amount_paise: 100, bank_ref: 'R3', file_id: 'slip' }, { email: 'clerk@example.org' }, {});
    h.ctx.officeAppend_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Closes', { id: 'cx', campus: 'LMS1', close_date: '2026-10-21', closing_json: '{}' }, { email: 'x' }, {});
    const r = dep(h, { id: 'c3' });
    assert.equal(r.success, false); assert.equal(r.code, 'LEGS_MISSING');
    assert.equal(rows(h, 'DayBook').length, before);
  });

  t.test('campus and role enforced', () => {
    const h = fresh(); fee(h, 5000);
    assert.equal(dep(h, {}, 'other-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(h.call('recon.get', { campus: 'LMS1', date: '2026-10-20' }, 'other-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(h.call('erp.set', { id: 'z', campus: 'LMS1', total_date: '2026-10-20', amount_paise: 1 }, 'other-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(h.call('deposit.add', { id: 'z', campus: 'LMS1' }, 'fh-token').error, 'FORBIDDEN_ROLE');
  });
  // I2 / R41: a retry that lands after 1 April finds the original in the previous year's book (probe2).
  const yearEnd = () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2027-28');
    h.setNow(new Date('2027-03-31T06:00:00Z'));
    h.call('file.upload', { id: 'slip', campus: 'LMS1', category: 'deposit_proof', mime: 'application/pdf', base64: PDF, name: 's.pdf' }, 'clerk-token');
    fee(h, 10000, '2027-03-31');
    return h;
  };
  const book = (h, fy, tab) => h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', fy), tab);

  t.test('deposit.add retried on 1 April is a duplicate, not a second deposit', () => {
    const h = yearEnd();
    const d = { id: 'dep1', covers_date: '2027-03-31', amount_paise: 10000, bank_ref: 'X' };
    assert.equal(dep(h, d).success, true);
    h.setNow(new Date('2027-04-01T06:00:00Z'));
    fee(h, 20000, '2027-04-01');
    const r = dep(h, d);
    assert.equal(r.success, true); assert.equal(r.duplicate, true);
    assert.equal(book(h, '2027-28', 'Deposits').length, 0);
    assert.equal(book(h, '2027-28', 'DayBook').filter((x) => /^dep1:/.test(x.id)).length, 0);
    assert.equal(recon(h, '2027-03-31').deposited, 10000);
  });

  t.test('opening.set and daybook.reverse retried across 1 April are duplicates', () => {
    const h = yearEnd();
    h.setNow(new Date('2027-03-31T07:00:00Z'));
    const rev = { id: 'rv1', campus: 'LMS1', reverses: 'f' + n };
    assert.equal(h.call('daybook.reverse', rev, 'clerk-token').success, true);
    h.setNow(new Date('2027-04-01T06:00:00Z'));
    const again = h.call('daybook.reverse', rev, 'clerk-token');
    assert.deepEqual([again.success, again.duplicate], [true, true], 'not ALREADY_REVERSED (M4)');
    // opening.set saved on the last day of a fresh year book, retried after 1 April.
    const g = boot(fixture); g.addConfig(); g.addBook('LMS1', '2026-27'); g.addBook('LMS1', '2027-28');
    g.setNow(new Date('2027-03-31T06:00:00Z'));
    const op = { id: 'op1', campus: 'LMS1', balances: [{ mode: 'bank', amount_paise: 700 }] };
    assert.equal(g.call('opening.set', op, 'fh-token').success, true);
    g.setNow(new Date('2027-04-01T06:00:00Z'));
    const r = g.call('opening.set', op, 'fh-token');
    assert.deepEqual([r.success, r.duplicate], [true, true]);
    assert.equal(g.ctx.officeRows_(g.ctx.officeOpen_('LMS1', '2027-28'), 'Opening').length, 0);
  });
  // I1 / R37: deposit legs are written only by deposit.add and never split (probe).
  t.test('daybook.add refuses deposit leg categories; daybook.reverse refuses a leg', () => {
    const h = fresh(); fee(h, 8000, '2026-10-21');
    ['deposit_cash_out', 'deposit_bank_in'].forEach((c) => {
      const r = fee(h, 700, '2026-10-21', { category: c, direction: c === 'deposit_cash_out' ? 'OUT' : 'IN', mode: c === 'deposit_cash_out' ? 'cash' : 'bank', bucket: c === 'deposit_cash_out' ? 'fee' : '' });
      assert.equal(r.code, 'DEPOSIT_LEG_CATEGORY', c);
    });
    assert.equal(dep(h, { id: 'dep1', covers_date: '2026-10-21' }).success, true);
    ['dep1:out', 'dep1:in'].forEach((leg) => assert.equal(h.call('daybook.reverse', { id: 'rv-' + leg, campus: 'LMS1', reverses: leg }, 'clerk-token').code, 'DEPOSIT_LEG', leg));
    assert.equal(rows(h, 'DayBook').filter((r) => r.reverses).length, 0);
  });
};
