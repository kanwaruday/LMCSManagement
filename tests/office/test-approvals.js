// lane-d Day Book slice 2 (Uday, 19 Nov: "a cash entry above 2000 should be sent for approvals"): a cash payment above the school's
// limit waits for the Principal (or the Owner) and counts nowhere until approved (apps-script/office-daybook.gs). Synthetic data only.
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
  const petty = (h, d = '2026-10-21') => h.call('daybook.balances', { campus: 'LMS1', date: d }, 'clerk-token').closing.cash.petty;
  const listed = (h) => h.call('daybook.list', { campus: 'LMS1', from: '2026-10-21' }, 'clerk-token').entries;

  t.test('approvals: above ₹2,000 waits (counts nowhere); at and below ₹2,000 count at once; bank is never gated', () => {
    const h = fresh();
    const above = pay(h, { id: 'big', amount_paise: 200001 });
    assert.equal(above.pending, true); assert.equal(above.limit_paise, 200000);
    assert.equal(petty(h), 1000000, 'a pending payment isn\'t in the balance');
    assert.equal(pay(h, { id: 'at', amount_paise: 200000 }).pending, undefined);
    assert.equal(pay(h, { id: 'below', amount_paise: 199999 }).pending, undefined);
    assert.equal(petty(h), 1000000 - 399999);
    assert.equal(h.call('daybook.add', { id: 'bk', campus: 'LMS1', entry_date: '2026-10-21', account: 'bank:LMS1', mode: 'bank', direction: 'OUT', category: 'utilities', amount_paise: 900000, payee: 'P', narration: 'x', file_id: 'slip' }, 'owner-token').pending, undefined);
    const big = listed(h).find((e) => e.id === 'big');
    assert.equal(big.approval, 'pending'); assert.equal(big.created_by, 'clerk@example.org');
    assert.deepEqual(h.call('daybook.pending', { campus: 'LMS1', state: 'pending' }, 'p1-token').entries.map((e) => e.id), ['big']);
    assert.equal(pay(h, { id: 'big', amount_paise: 200001 }).duplicate, true, 'a resend is a retry, not a second request');
  });

  t.test('approvals: approve → counts on the day it was entered, still the clerk\'s, says who approved; decided once', () => {
    const h = fresh();
    pay(h, { id: 'big', entry_date: '2026-10-20' });
    const r = decide(h, 'big', true, { id: 'dec1' });
    assert.equal(r.state, 'approved');
    assert.equal(petty(h, '2026-10-20'), 1000000 - 300000);
    const e = h.call('daybook.list', { campus: 'LMS1', from: '2026-10-20' }, 'clerk-token').entries.find((x) => x.id === 'big');
    assert.equal(e.approval, 'approved'); assert.equal(e.decided_by, 'p1@example.org'); assert.equal(e.created_by, 'clerk@example.org');
    assert.equal(decide(h, 'big', true, { id: 'dec1' }).duplicate, true, 'a retry of the same decision');
    assert.equal(decide(h, 'big', false, { reason: 'changed my mind' }).error, 'ALREADY_DECIDED');
  });

  t.test('approvals: reject needs a reason; the entry stays listed as rejected and never counts', () => {
    const h = fresh();
    pay(h, { id: 'big' });
    assert.equal(decide(h, 'big', false, { reason: ' ' }).error, 'REASON_REQUIRED');
    assert.equal(decide(h, 'big', false, { reason: 'No quotation attached' }).state, 'rejected');
    const e = listed(h).find((x) => x.id === 'big');
    assert.equal(e.approval, 'rejected'); assert.equal(e.reject_reason, 'No quotation attached'); assert.equal(e.decided_by, 'p1@example.org');
    assert.equal(petty(h), 1000000);
    assert.equal(decide(h, 'big', true).error, 'ALREADY_DECIDED');
  });

  t.test('approvals: the cash floor applies at approval: two payments fine alone, the second can\'t be approved once the first is', () => {
    const h = fresh(500000);
    pay(h, { id: 'one', amount_paise: 300000 }); pay(h, { id: 'two', amount_paise: 300000 });
    assert.equal(decide(h, 'one', true).state, 'approved');
    assert.equal(decide(h, 'two', true).error, 'INSUFFICIENT_CASH');
    assert.equal(petty(h), 200000);
    assert.equal(h.call('daybook.pending', { campus: 'LMS1', state: 'pending' }, 'p1-token').entries.length, 1, 'still waiting, can be rejected or approved later');
  });

  t.test('approvals: another school\'s Principal, a Fee Clerk, or the person who entered it can\'t decide; the Owner can', () => {
    const h = fresh();
    pay(h, { id: 'big' });
    assert.equal(decide(h, 'big', true, {}, 'p2-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(decide(h, 'big', true, { campus: 'LMS2' }, 'p2-token').error, 'NOT_FOUND', 'not in their school\'s books');
    assert.equal(decide(h, 'big', true, {}, 'clerk-token').error, 'FORBIDDEN_ROLE');
    pay(h, { id: 'mine' }, 'pc-token');
    assert.equal(decide(h, 'mine', true, {}, 'pc-token').error, 'OWN_ENTRY');
    assert.equal(decide(h, 'big', true, {}, 'owner-token').state, 'approved');
  });

  t.test('approvals: the Owner sets a school\'s limit (config.get shows it); a Principal can\'t', () => {
    const h = fresh();
    assert.equal(h.call('limit.set', { campus: 'LMS1', limit_paise: 500000 }, 'p1-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('limit.set', { campus: 'LMS1', limit_paise: -1 }, 'owner-token').error, 'BAD_AMOUNT');
    assert.equal(h.call('limit.set', { campus: 'LMS1', limit_paise: 500000 }, 'owner-token').success, true);
    const lim = h.call('config.get', {}, 'owner-token').approval_limits;
    assert.equal(lim.LMS1, 500000); assert.equal(lim.LMS2, 200000);
    assert.equal(pay(h, { amount_paise: 400000 }).pending, undefined, 'under the new limit');
    assert.equal(pay(h, { amount_paise: 500001 }).pending, true);
  });

  t.test('approvals: a closed day takes no approval (the Owner reopens it first)', () => {
    const h = fresh();
    pay(h, { id: 'big', entry_date: '2026-10-20' });
    assert.equal(h.call('day.close', { id: 'c1', campus: 'LMS1', close_date: '2026-10-20' }, 'owner-token').success, true);
    assert.equal(decide(h, 'big', true).error, 'DAY_CLOSED');
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
