// lane-d Day Book slice 2 (Uday, 19 Nov: "a cash entry above 2000 should be sent for approvals"), changed 26 Nov (Uday: "lets move this to 5000, payments above that
// cannot be made in cash"): cash payments stop at the limit (₹5,000, CASH_ABOVE_LIMIT, no Pending); above it is a payment request (test-payreq.js). What still waits
// for the Principal (or the Owner) is taking back a cash receipt above the limit (a reversal pays cash out). Synthetic data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'p1-token': 'p1@example.org', 'p2-token': 'p2@example.org', 'owner-token': 'owner@example.org', 'pc-token': 'pc@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['p1@example.org', 'Principal One', 'LMS1', 'Principal'],
    ['p2@example.org', 'Principal Two', 'LMS2', 'Principal'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
    ['pc@example.org', 'Principal and clerk', 'LMS1', 'Principal,FeeClerk'],
  ],
};

module.exports = function run(t) {
  const fresh = (petty = 1000000) => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS2', '2026-27');
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Files', { id: 'slip', campus: 'LMS1', drive_id: 'D1', name: 's.jpg' });
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Opening', { id: 'seed', campus: 'LMS1', mode: 'cash', bucket: 'petty', amount_paise: petty });
    return h;
  };
  let n = 0;
  const pay = (h, o, tok) => h.call('daybook.add', Object.assign({ id: 'a' + (++n), campus: 'LMS1', entry_date: '2026-10-21', account: 'cash:LMS1', direction: 'OUT', mode: 'cash',
    bucket: 'petty', category: 'stationery', amount_paise: 300000, payee: 'Shop', narration: 'x', file_id: 'slip' }, o), tok || 'clerk-token');
  const decide = (h, entry, approve, o, tok) => h.call('daybook.decide', Object.assign({ id: 'd-' + entry + '-' + (++n), campus: 'LMS1', entry_id: entry, approve }, o), tok || 'p1-token');
  // a reversal of a ₹6,000 cash receipt waits for approval: the one thing that still goes to the Principal; its id is the waiting entry's id
  const wait = (h, id, o) => { h.call('daybook.add', { id: 'src-' + id, campus: 'LMS1', entry_date: '2026-10-21', account: 'cash:LMS1', direction: 'IN', mode: 'cash', bucket: 'petty', category: 'other_in', amount_paise: 600000, payee: 'Parent', narration: 'x' }, 'clerk-token');
    return h.call('daybook.reverse', Object.assign({ id, campus: 'LMS1', reverses: 'src-' + id, narration: 'Entered twice' }, o), 'clerk-token'); };
  const petty = (h, d = '2026-10-21') => h.call('daybook.balances', { campus: 'LMS1', date: d }, 'clerk-token').closing.cash.petty;
  const listed = (h) => h.call('daybook.list', { campus: 'LMS1', from: '2026-10-21' }, 'clerk-token').entries;

  t.test('cash limit: ₹5,000 and below is paid in cash at once; above it is refused (CASH_ABOVE_LIMIT); bank is never gated', () => {
    const h = fresh();
    assert.equal(pay(h, { id: 'at', amount_paise: 500000, payee: 'Shop A' }).error, undefined);
    assert.equal(pay(h, { id: 'big', amount_paise: 500001, payee: 'Shop B' }).error, 'CASH_ABOVE_LIMIT');
    assert.equal(petty(h), 1000000 - 500000, 'a refused payment is nowhere in the books');
    assert.equal(h.call('daybook.pending', { campus: 'LMS1', state: 'pending' }, 'p1-token').entries.length, 0, 'nothing waits for the Principal any more');
    assert.equal(h.call('daybook.add', { id: 'bk', campus: 'LMS1', entry_date: '2026-10-21', account: 'bank:LMS1', mode: 'bank', direction: 'OUT', category: 'utilities', amount_paise: 900000, payee: 'P', narration: 'x', file_id: 'slip' }, 'clerk-token').error, 'FORBIDDEN_ACCOUNT', 'a clerk never pays from the bank: that is the Finance Head\'s');
    assert.equal(h.call('daybook.add', { id: 'bk2', campus: 'LMS1', entry_date: '2026-10-21', account: 'bank:LMS1', mode: 'bank', direction: 'OUT', category: 'utilities', amount_paise: 900000, payee: 'P', narration: 'x', file_id: 'slip' }, 'owner-token').error, undefined, 'bank is not under the cash limit');
    assert.equal(pay(h, { id: 'at', amount_paise: 500000, payee: 'Shop A' }).duplicate, true, 'a resend of a saved entry is a retry, not refused');
  });

  t.test('cash limit: a bill split to stay under it: 3,000 + 2,500 to one payee is refused; 3,000 + 1,900 is fine', () => {
    const h = fresh(5000000);
    assert.equal(pay(h, { id: 's1', amount_paise: 300000, payee: 'Demo Traders' }).error, undefined);
    assert.equal(pay(h, { id: 's2', amount_paise: 250000, payee: '  demo   TRADERS ' }).error, 'CASH_ABOVE_LIMIT', 'same payee, spaces and case aside');
    assert.equal(pay(h, { id: 's3', amount_paise: 190000, payee: 'Demo Traders' }).error, undefined);
    assert.equal(pay(h, { id: 's4', amount_paise: 300000, payee: 'Other Shop' }).success, true, 'another payee');
    assert.equal(pay(h, { id: 's5', amount_paise: 300000, payee: 'Demo Traders', entry_date: '2026-10-20' }).success, true, 'another day');
  });

  t.test('cash limit: the Owner sets a school\'s limit (config.get shows it, default ₹5,000); a Principal can\'t', () => {
    const h = fresh();
    assert.equal(h.call('limit.set', { campus: 'LMS1', limit_paise: 300000 }, 'p1-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('limit.set', { campus: 'LMS1', limit_paise: -1 }, 'owner-token').error, 'BAD_AMOUNT');
    assert.equal(h.call('limit.set', { campus: 'LMS1', limit_paise: 300000 }, 'owner-token').success, true);
    const lim = h.call('config.get', {}, 'owner-token').approval_limits;
    assert.equal(lim.LMS1, 300000); assert.equal(lim.LMS2, 500000);
    assert.equal(pay(h, { id: 'u', amount_paise: 300000 }).error, undefined);
    assert.equal(pay(h, { id: 'o', amount_paise: 300001, payee: 'Other' }).error, 'CASH_ABOVE_LIMIT');
  });

  t.test('approvals: taking back a ₹6,000 cash receipt waits with its reason; a small one doesn\'t; approve counts it, decided once', () => {
    const h = fresh();
    const r = wait(h, 'rv1'); assert.equal(r.pending, true);
    h.call('daybook.add', { id: 'in2', campus: 'LMS1', entry_date: '2026-10-21', account: 'cash:LMS1', direction: 'IN', mode: 'cash', bucket: 'petty', category: 'other_in', amount_paise: 50000, payee: 'Parent', narration: 'x' }, 'clerk-token');
    assert.equal(petty(h), 1000000 + 600000 + 50000, 'not counted while it waits');
    assert.equal(h.call('daybook.reverse', { id: 'rv1', campus: 'LMS1', reverses: 'src-rv1', narration: 'Entered twice' }, 'clerk-token').duplicate, true);
    assert.equal(h.call('daybook.reverse', { id: 'rv2', campus: 'LMS1', reverses: 'src-rv1', narration: 'again' }, 'clerk-token').error, 'REVERSAL_PENDING');
    const w = h.call('daybook.pending', { campus: 'LMS1', state: 'pending' }, 'p1-token').entries[0];
    assert.equal(w.reverses, 'src-rv1'); assert.equal(w.narration, 'Entered twice');
    assert.equal(decide(h, 'rv1', true, { id: 'dec1' }).state, 'approved');
    assert.equal(petty(h), 1000000 + 50000);
    assert.equal(decide(h, 'rv1', true, { id: 'dec1' }).duplicate, true, 'a retry of the same decision');
    assert.equal(decide(h, 'rv1', false, { reason: 'changed my mind' }).error, 'ALREADY_DECIDED');
    assert.equal(h.call('daybook.reverse', { id: 'rv3', campus: 'LMS1', reverses: 'in2', narration: 'Wrong entry' }, 'clerk-token').pending, undefined);
  });

  t.test('approvals: reject needs a reason; the entry stays listed as rejected and never counts', () => {
    const h = fresh(); wait(h, 'big');
    assert.equal(decide(h, 'big', false, { reason: ' ' }).error, 'REASON_REQUIRED');
    assert.equal(decide(h, 'big', false, { reason: 'Not a mistake' }).state, 'rejected');
    assert.equal(petty(h), 1000000 + 600000);
    assert.equal(decide(h, 'big', true).error, 'ALREADY_DECIDED');
  });

  t.test('approvals: another school\'s Principal, a Fee Clerk, or the person who entered it can\'t decide; the Owner can', () => {
    const h = fresh(); wait(h, 'big');
    assert.equal(decide(h, 'big', true, {}, 'p2-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(decide(h, 'big', true, {}, 'clerk-token').error, 'FORBIDDEN_ROLE');
    h.call('daybook.add', { id: 'src-mine', campus: 'LMS1', entry_date: '2026-10-21', account: 'cash:LMS1', direction: 'IN', mode: 'cash', bucket: 'petty', category: 'other_in', amount_paise: 600000, payee: 'Parent', narration: 'x' }, 'pc-token');
    assert.equal(h.call('daybook.reverse', { id: 'mine', campus: 'LMS1', reverses: 'src-mine', narration: 'x y z' }, 'pc-token').pending, true);
    assert.equal(decide(h, 'mine', true, {}, 'pc-token').error, 'OWN_ENTRY');
    assert.equal(decide(h, 'big', true, {}, 'owner-token').state, 'approved');
  });

  t.test('approvals (G2): a day with a reversal waiting can\'t close (PENDING_APPROVALS); once it is decided it closes', () => {
    const h = fresh(); wait(h, 'big');
    const close = (id, d) => h.call('day.close', { id, campus: 'LMS1', close_date: d }, 'owner-token');
    h.setNow(new Date('2026-10-22T10:00:00Z'));   // the day after: yesterday can be closed
    assert.equal(close('c1', '2026-10-21').error, 'PENDING_APPROVALS');
    assert.equal(decide(h, 'big', false, { reason: 'Wrong school' }).state, 'rejected');
    assert.equal(close('c3', '2026-10-21').success, true);
  });

  t.test('floor across 1 April (G2b low): a payment backdated into last year must also fit this year\'s cash', () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2027-28');
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Opening', { id: 's1', campus: 'LMS1', mode: 'cash', bucket: 'petty', amount_paise: 100000 });
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2027-28'), 'Opening', { id: 's2', campus: 'LMS1', mode: 'cash', bucket: 'petty', amount_paise: 100000 });
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Files', { id: 'slip', campus: 'LMS1', drive_id: 'D1', name: 's.jpg' });
    h.setNow(new Date('2027-04-02T10:00:00Z'));
    assert.equal(pay(h, { id: 'now', entry_date: '2027-04-02', amount_paise: 90000 }).success, true);  // this year: 1000 → 100
    assert.equal(pay(h, { id: 'old', entry_date: '2027-03-31', amount_paise: 50000 }).error, 'INSUFFICIENT_CASH', 'last year had it, this year doesn\'t');
    assert.equal(pay(h, { id: 'old2', entry_date: '2027-03-31', amount_paise: 10000 }).success, true);
  });
};
