// today.summary (apps-script/office-today.gs): the Game backend's desk rows, every held campus in one call, flags only. Synthetic data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'c1-token': 'c1@example.org', 'c2-token': 'c2@example.org', 'fh-token': 'fh@example.org', 'pr-token': 'pr@example.org', 'co-token': 'co@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['c1@example.org', 'Clerk One', 'LMS1', 'FeeClerk'],
    ['c2@example.org', 'Clerk Two', 'LMS2', 'FeeClerk'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['pr@example.org', 'Principal', 'LMS1', 'Principal'],
    ['co@example.org', 'Coordinator', 'ALL', 'Coordinator'],
  ],
};
const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); ['LMS1', 'LMS2'].forEach((c) => h.addBook(c, '2026-27'));
    h.setNow(new Date('2026-10-21T10:00:00Z')); // 15:30 IST 2026-10-21
    h.call('file.upload', { id: 'slip', campus: 'LMS1', category: 'deposit_proof', mime: 'application/pdf', base64: PDF, name: 's.pdf' }, 'c1-token');
    return h;
  };
  let n = 0;
  const fee = (h, amt, date) => h.call('daybook.add', { id: 'f' + (++n), campus: 'LMS1', entry_date: date, account: 'cash:LMS1', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: amt }, 'c1-token');
  const sum = (h, tok) => J(h.call('today.summary', {}, tok));

  t.test('summary: the clerk gets their own campus only, with today.get\'s tasks and yesterday as flags', () => {
    const h = fresh(); fee(h, 5000, '2026-10-20');
    const r = sum(h, 'c1-token');
    assert.equal(r.success, true); assert.equal(r.date, '2026-10-21'); assert.equal(r.yesterday, '2026-10-20');
    assert.deepEqual(Object.keys(r.campuses), ['LMS1']);
    const c = r.campuses.LMS1;
    assert.deepEqual(c.can, { report: true, close: false });
    assert.deepEqual(c.tasks.map((x) => x.id), h.call('today.get', { campus: 'LMS1' }, 'c1-token').tasks.map((x) => x.id));
    assert.deepEqual(c.day, { booked: true, cash: true, banked: false, erp: false, closed: false, unsigned: 0 });
    assert.ok(!/amount|paise|5000/.test(JSON.stringify(r)), 'no amounts in the summary');
  });

  t.test('summary: deposit, ERP total, sign and close flip the flags', () => {
    const h = fresh(); fee(h, 5000, '2026-10-20');
    h.call('erp.set', { id: 'e1', campus: 'LMS1', total_date: '2026-10-20', amount_paise: 5000 }, 'c1-token');
    assert.equal(h.call('deposit.add', { id: 'd1', campus: 'LMS1', covers_date: '2026-10-20', amount_paise: 5000, bank_ref: 'CH-1', file_id: 'slip' }, 'c1-token').success, true);
    let d = sum(h, 'c1-token').campuses.LMS1.day;
    assert.deepEqual([d.banked, d.erp, d.unsigned, d.closed], [true, true, 1, false]);
    const fh = sum(h, 'fh-token');
    assert.deepEqual(Object.keys(fh.campuses), ['LMS1', 'LMS2'], 'a network-wide Finance Head: every campus with a book');
    assert.deepEqual(fh.campuses.LMS1.can, { report: false, close: true });
    assert.ok(fh.campuses.LMS1.tasks.some((x) => x.id === 'close:2026-10-20'));
    h.call('deposit.sign', { id: 's1', campus: 'LMS1', deposit_id: 'd1' }, 'fh-token');
    h.call('day.close', { id: 'c1', campus: 'LMS1', close_date: '2026-10-20' }, 'fh-token');
    d = sum(h, 'fh-token').campuses.LMS1.day;
    assert.deepEqual([d.unsigned, d.closed], [0, true]);
    assert.equal(sum(h, 'fh-token').campuses.LMS2.day.booked, false, 'a quiet campus: nothing booked yesterday');
  });

  t.test('summary: cash handed to a campus shows to its desk while pending and for a day after it is accepted; never to the sender', () => {
    const h = fresh();
    assert.equal(h.call('cash.handover', { id: 'h1', date: '2026-10-21', from_account: 'cash:LMS1', to_account: 'cash:LMS2', amount_paise: 20000, bucket: 'fee', note: '' }, 'c1-token').success, true);
    assert.deepEqual(sum(h, 'c2-token').campuses.LMS2.handovers, [{ id: 'h1', from: 'LMS1', date: '2026-10-21', state: 'pending' }]);
    assert.deepEqual(sum(h, 'c1-token').campuses.LMS1.handovers, []);
    h.setNow(new Date('2026-10-22T05:00:00Z'));
    assert.equal(h.call('cash.accept', { id: 'r1', handover: 'h1' }, 'c2-token').success, true);
    assert.deepEqual(sum(h, 'c2-token').campuses.LMS2.handovers.map((x) => x.state), ['accepted']);
    h.setNow(new Date('2026-10-24T05:00:00Z'));
    assert.deepEqual(sum(h, 'c2-token').campuses.LMS2.handovers, [], 'accepted two days ago: no longer today\'s story');
  });

  t.test('summary: a Principal or a Coordinator alone is refused (money is the desk\'s)', () => {
    const h = fresh();
    assert.equal(h.call('today.summary', {}, 'pr-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('today.summary', {}, 'co-token').error, 'FORBIDDEN_ROLE');
  });
};
