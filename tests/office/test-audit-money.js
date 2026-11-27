// Audit 27 Nov, money items owned by the office (V2, 28 Nov): #4 old held payments, #5 the payee limit rule. (#7 and #9 are in
// test-seal-gate.js and test-payreq.js.) Synthetic data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'pr-token': 'pr@example.org', 'owner-token': 'owner@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['pr@example.org', 'Principal', 'LMS1', 'Principal'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
  ],
};

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture); h.addConfig(); h.addBook('LMS1', '2026-27');
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    const ss = h.ctx.officeOpen_('LMS1', '2026-27');
    ['petty', 'fee', 'other'].forEach((b) => h.ctx.officeWriteRow_(ss, 'Opening', { id: 'seed-' + b, campus: 'LMS1', mode: 'cash', bucket: b, amount_paise: 100000000 }));
    h.ctx.officeWriteRow_(ss, 'Files', { id: 'slip', campus: 'LMS1', drive_id: 'D1', name: 's.jpg' });
    return h;
  };
  let n = 0;
  const pay = (o) => Object.assign({ id: 'e' + (++n), campus: 'LMS1', entry_date: '2026-10-21', account: 'cash:LMS1', direction: 'OUT', mode: 'cash', bucket: 'petty', category: 'stationery', amount_paise: 100000, payee: 'Ram', narration: 'x', file_id: 'slip' }, o);
  const add = (h, o) => h.call('daybook.add', pay(o), 'clerk-token');
  const rows = (h) => h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'DayBook');
  // an entry held for the Principal before 26 Nov (nothing new goes to Pending): written as the old code wrote it
  const held = (h, o) => { const r = pay(o); h.ctx.officeAppend_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Pending', { id: r.id, campus: 'LMS1', entry_date: r.entry_date, direction: r.direction, mode: r.mode, bucket: r.bucket, category: r.category, amount_paise: r.amount_paise, payee: r.payee, narration: r.narration, file_id: r.file_id, account: r.account, row: JSON.stringify(Object.assign({ reverses: '' }, r)) }, { email: 'clerk@example.org' }, {}); return r.id; };
  const decide = (h, id, approve) => h.call('daybook.decide', { id: 'd' + (++n), campus: 'LMS1', entry_id: id, approve, reason: approve ? '' : 'raise a payment request' }, 'pr-token');

  t.test('audit #4: an old held cash payment above ₹5,000 is ABOVE_LIMIT_USE_REQUEST on approve, writes nothing, and can be rejected', () => {
    const h = fresh();
    const big = held(h, { amount_paise: 600000 });
    const r = decide(h, big, true);
    assert.deepEqual([r.success, r.code], [false, 'ABOVE_LIMIT_USE_REQUEST']);
    assert.equal(rows(h).length, 0);
    assert.equal(decide(h, big, false).state, 'rejected');
  });

  t.test('audit #4: an old held payment within the limit approves; one that the day\'s same-payee payments push over does not', () => {
    const h = fresh();
    const small = held(h, { amount_paise: 300000, payee: 'Shyam' });
    assert.equal(decide(h, small, true).state, 'approved');
    assert.equal(rows(h).length, 1);
    assert.equal(add(h, { amount_paise: 300000, payee: 'Mohan' }).success, true);
    const split = held(h, { amount_paise: 300000, payee: 'Mohan ji' });
    assert.equal(decide(h, split, true).code, 'ABOVE_LIMIT_USE_REQUEST', '₹3,000 + ₹3,000 to the same payee that day');
  });

  t.test('audit #4: a held reversal is not a payment: it still approves above the limit', () => {
    const h = fresh();
    const rev = held(h, { amount_paise: 900000, reverses: 'old-in', direction: 'OUT', category: 'fee_collection', bucket: 'fee', payee: '' });
    assert.equal(decide(h, rev, true).state, 'approved');
  });

  t.test('audit #5: a cash payment needs a payee (PAYEE_REQUIRED); money in, bank and credit rows do not', () => {
    const h = fresh();
    assert.equal(add(h, { payee: '' }).error, 'PAYEE_REQUIRED');
    assert.equal(add(h, { payee: ' Shri ji ' }).error, 'PAYEE_REQUIRED', 'honorifics alone are no payee');
    assert.equal(add(h, { direction: 'IN', category: 'fee_collection', bucket: 'fee', payee: '', file_id: undefined }).success, true);
    assert.equal(rows(h).length, 1);
    assert.equal(add(h, { payee: 'Ram' }).success, true);
  });

  t.test('audit #5: one payee key ("Ram", "Shri Ram ji", "RAM.") and cash + bank + UPI add up for the day', () => {
    const h = fresh();
    assert.equal(h.ctx.officePayeeKey_('Shri Ram ji'), 'ram'); assert.equal(h.ctx.officePayeeKey_('RAM.'), 'ram');
    assert.equal(h.ctx.officePayeeKey_('M/s Sharma  Traders'), 'sharmatraders'); assert.equal(h.ctx.officePayeeKey_(''), '');
    assert.equal(add(h, { amount_paise: 300000, payee: 'Ram' }).success, true);
    assert.equal(add(h, { amount_paise: 250000, payee: 'Shri Ram ji' }).error, 'ABOVE_LIMIT_USE_REQUEST', 'a split bill by spelling');
    assert.equal(h.call('daybook.add', pay({ amount_paise: 250000, payee: 'RAM.', account: 'bank:LMS1', mode: 'bank', bucket: '' }), 'owner-token').error, 'ABOVE_LIMIT_USE_REQUEST', 'cash + bank add up');
    assert.equal(add(h, { amount_paise: 200000, payee: 'Ram' }).success, true, '₹3,000 + ₹2,000 is the limit itself: allowed');
    assert.equal(add(h, { amount_paise: 300000, payee: 'Ram', entry_date: '2026-10-20' }).success, true, 'another day is its own day');
  });

  t.test('audit #5: a reversed payment no longer counts; a different payee is not added', () => {
    const h = fresh();
    const first = add(h, { amount_paise: 400000, payee: 'Ram' });
    assert.equal(add(h, { amount_paise: 200000, payee: 'Ram' }).error, 'ABOVE_LIMIT_USE_REQUEST');
    assert.equal(h.call('daybook.reverse', { id: 'rv1', campus: 'LMS1', reverses: first.id, narration: 'wrong amount' }, 'clerk-token').success, true);
    assert.equal(add(h, { amount_paise: 200000, payee: 'Ram' }).success, true);
    assert.equal(add(h, { amount_paise: 450000, payee: 'Sita' }).success, true);
  });

  t.test('audit #5: the 7-day warning: the same payee above the limit over this day and the 6 before is saved with payee_week_over_limit', () => {
    const h = fresh();
    assert.equal(add(h, { amount_paise: 400000, payee: 'Ram', entry_date: '2026-10-15' }).warnings, undefined);
    assert.deepEqual(add(h, { amount_paise: 200000, payee: 'Ram ji', entry_date: '2026-10-21' }).warnings, ['payee_week_over_limit']);
    assert.equal(add(h, { amount_paise: 200000, payee: 'Ram', entry_date: '2026-10-14' }).warnings, undefined, 'the window looks back only: later days do not count');
    assert.equal(rows(h).length, 3);
  });

  t.test('audit #5: daybook.list flags the week\'s near-limit payee for the approver; a reversed row is not flagged', () => {
    const h = fresh();
    add(h, { amount_paise: 400000, payee: 'Ram', entry_date: '2026-10-15' });
    const second = add(h, { amount_paise: 200000, payee: 'Ram ji', entry_date: '2026-10-21' });
    add(h, { amount_paise: 100000, payee: 'Sita', entry_date: '2026-10-21' });
    const list = () => h.call('daybook.list', { campus: 'LMS1', from: '2026-10-15', to: '2026-10-21' }, 'owner-token').entries.filter((r) => r.payee_week_over_limit).map((r) => r.id);
    assert.deepEqual(list(), [second.id]);
    h.call('daybook.reverse', { id: 'rv2', campus: 'LMS1', reverses: second.id, narration: 'wrong' }, 'clerk-token');
    assert.deepEqual(list(), []);
  });
};
