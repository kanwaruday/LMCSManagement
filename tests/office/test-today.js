// Today task list (apps-script/office-today.gs).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org', 'pr-token': 'pr@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
    ['pr@example.org', 'Principal', 'LMS1', 'Principal'],
  ],
};
const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');
const REPORT = { campus: 'LMS1', cash: { petty: 0, fee: 0, other: 0 }, footfall: 1, hourly: [] };

module.exports = function run(t) {
  const fresh = (iso) => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26');
    h.setNow(new Date(iso || '2026-10-21T10:00:00Z')); // 15:30 IST
    h.call('file.upload', { id: 'slip', campus: 'LMS1', category: 'deposit_proof', mime: 'application/pdf', base64: PDF, name: 's.pdf' }, 'clerk-token');
    return h;
  };
  let n = 0;
  const fee = (h, amt, date) => h.call('daybook.add', { id: 'f' + (++n), campus: 'LMS1', entry_date: date, direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: amt }, 'clerk-token');
  const get = (h, tok) => h.call('today.get', { campus: 'LMS1' }, tok || 'clerk-token');
  const ids = (r) => r.tasks.map((x) => x.id);
  const one = (r, id) => r.tasks.filter((x) => x.id === id)[0];

  t.test('clerk sees report and deposit tasks, not day close', () => {
    const h = fresh(); fee(h, 5000, '2026-10-20');
    const r = get(h);
    assert.equal(r.success, true); assert.equal(r.date, '2026-10-21');
    assert.deepEqual(one(r, 'report:2026-10-21'), { id: 'report:2026-10-21', title: 'Submit the daily report', due: '2026-10-21 18:00', status: 'due', action: 'report' });
    assert.equal(one(r, 'deposit:2026-10-20').status, 'due');
    assert.equal(one(r, 'deposit:2026-10-20').action, 'deposits');
    assert.ok(!ids(r).some((i) => /^(close|sign):/.test(i)));
    assert.deepEqual(get(h, 'pr-token').tasks, [], 'principal has no tasks');
  });

  t.test('older undeposited day is overdue and sorts first; report overdue after 18:00', () => {
    const h = fresh('2026-10-21T13:00:00Z'); // 18:30 IST
    fee(h, 5000, '2026-10-19');
    const r = get(h);
    assert.equal(one(r, 'deposit:2026-10-19').status, 'overdue');
    assert.equal(one(r, 'report:2026-10-21').status, 'overdue');
    assert.deepEqual(ids(r), ['deposit:2026-10-19', 'report:2026-10-21']);
  });

  t.test('report task flips to done after report.submit', () => {
    const h = fresh();
    h.call('report.submit', Object.assign({ id: 'r1', report_date: '2026-10-21' }, REPORT), 'clerk-token');
    const r = get(h);
    assert.equal(one(r, 'report:2026-10-21').status, 'done');
    assert.equal(r.tasks[r.tasks.length - 1].id, 'report:2026-10-21', 'done sorts last');
  });

  t.test('finance head sees unsigned deposits and day close', () => {
    const h = fresh(); fee(h, 5000, '2026-10-20');
    h.call('daybook.add', { id: 'seed', campus: 'LMS1', entry_date: '2026-10-21', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 5000 }, 'clerk-token');
    assert.equal(h.call('deposit.add', { id: 'd1', campus: 'LMS1', covers_date: '2026-10-20', amount_paise: 5000, bank_ref: 'CH-1', file_id: 'slip' }, 'clerk-token').success, true);
    const r = get(h, 'fh-token');
    assert.equal(one(r, 'sign:2026-10-20').status, 'due');
    assert.equal(one(r, 'close:2026-10-20').action, 'close');
    assert.ok(!ids(r).some((i) => /^(report|deposit):/.test(i)));
    h.call('deposit.sign', { id: 's1', campus: 'LMS1', deposit_id: 'd1' }, 'fh-token');
    h.call('day.close', { id: 'c1', campus: 'LMS1', close_date: '2026-10-20' }, 'fh-token');
    assert.deepEqual(ids(get(h, 'fh-token')), [], 'signed and closed: nothing left (today has rows but is not past)');
    assert.deepEqual(ids(get(h, 'owner-token')).sort(), ['report:2026-10-21']);
  });

  t.test('provider that throws is skipped and reported as a task with status waiting, others still return', () => {
    const h = boot(fixture, { extraSource: 'var orig_ = officeTodayProviders_; officeTodayProviders_ = function () { return orig_().concat([function () { throw new Error("boom"); }]); };' });
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26'); h.setNow(new Date('2026-10-21T10:00:00Z'));
    const r = get(h);
    assert.equal(r.success, true);
    assert.deepEqual(one(r, 'provider:4'), { id: 'provider:4', title: 'Some tasks could not load', due: '2026-10-21', status: 'waiting', action: 'today' });
    assert.ok(one(r, 'report:2026-10-21'));
  });

  t.test('campus required and enforced', () => {
    const h = fresh();
    assert.equal(h.call('today.get', {}, 'clerk-token').error, 'MISSING_CAMPUS');
    assert.equal(h.call('today.get', { campus: 'LMS2' }, 'clerk-token').error, 'FORBIDDEN_CAMPUS');
  });
};
