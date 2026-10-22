// Daily Report and substitute grant (apps-script/office-report.gs).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'sub-token': 'sub@example.org', 'am-token': 'am@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['sub@example.org', 'Sub', 'LMS1', 'Teacher'],
    ['am@example.org', 'Admin Manager', 'ALL', 'AdminManager'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
  ],
};

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); h.book = h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26');
    h.setNow(new Date('2026-10-21T10:00:00Z')); // 15:30 IST
    return h;
  };
  let n = 0;
  const rep = (o) => Object.assign({ id: 'p' + (++n), campus: 'LMS1', report_date: '2026-10-21', hourly: [{ hour: '9', text: 'fees' }], footfall: 12, feedback_pos: 'ok', feedback_neg: '', leave_status: 'none', external_docs: 'none', cash: { petty: 100, fee: 5000, other: 0 } }, o);
  const submit = (h, o, tok) => h.call('report.submit', rep(o), tok || 'clerk-token');
  const grant = (h, o) => h.call('substitute.grant', Object.assign({ id: 'g' + (++n), campus: 'LMS1', email: 'sub@example.org', from_date: '2026-10-20', to_date: '2026-10-22' }, o), 'am-token');
  const get = (h, d, tok) => h.call('report.get', { campus: 'LMS1', report_date: d || '2026-10-21' }, tok || 'clerk-token');

  t.test('report before 18:00 is on time, after is accepted with late true', () => {
    const h = fresh();
    assert.equal(submit(h, { id: 'a' }).success, true);
    assert.equal(get(h).report.late, false);
    h.setNow(new Date('2026-10-21T12:30:01Z')); // 18:00:01 IST
    assert.equal(submit(h, { id: 'b' }).success, true);
    assert.equal(get(h).report.late, true);
    assert.equal(get(h).report.id, 'b');
    assert.equal(h.ctx.officeRows_(h.book, 'Reports')[1].late, true);
    h.setNow(new Date('2026-10-22T04:00:00Z')); // next day: late for a past date
    submit(h, { id: 'c', report_date: '2026-10-21' });
    assert.equal(get(h).report.late, true);
  });

  t.test('late parse is case-insensitive', () => {
    assert.equal(fresh().ctx.officeCell_('late', 'TRUE'), true);
    assert.equal(fresh().ctx.officeCell_('late', 'false'), false);
  });

  t.test('second submit for the same date is a new row; latest wins; same id is a duplicate', () => {
    const h = fresh();
    submit(h, { id: 'a', footfall: 1 });
    h.setNow(new Date('2026-10-21T10:05:00Z'));
    submit(h, { id: 'b', footfall: 2 });
    assert.equal(submit(h, { id: 'b', footfall: 9 }).duplicate, true);
    assert.equal(h.ctx.officeRows_(h.book, 'Reports').length, 2);
    const r = get(h).report;
    assert.equal(r.id, 'b'); assert.equal(r.footfall, 2); assert.equal(r.submitted_for, 'self');
    assert.equal(get(h, '2026-10-19').report, null);
  });

  t.test('substitute can submit but cannot call daybook.add', () => {
    const h = fresh();
    assert.equal(submit(h, {}, 'sub-token').error, 'FORBIDDEN_ROLE');
    assert.equal(grant(h).success, true);
    const r = submit(h, { id: 'sr' }, 'sub-token');
    assert.equal(r.success, true);
    assert.equal(get(h).report.submitted_for, 'substitute');
    const add = h.call('daybook.add', { id: 'e1', campus: 'LMS1', entry_date: '2026-10-21', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 100 }, 'sub-token');
    assert.equal(add.error, 'FORBIDDEN_ROLE');
    assert.equal(get(h, '2026-10-21', 'sub-token').error, 'FORBIDDEN_ROLE');
  });

  t.test('grant outside its date range does nothing', () => {
    const h = fresh();
    grant(h, { from_date: '2026-10-22', to_date: '2026-10-25' });
    assert.equal(submit(h, {}, 'sub-token').error, 'FORBIDDEN_ROLE');
    grant(h, { from_date: '2026-10-10', to_date: '2026-10-20', email: 'SUB@example.org' });
    assert.equal(submit(h, {}, 'sub-token').error, 'FORBIDDEN_ROLE');
  });

  t.test('a substitute grant never crosses campuses', () => {
    const h = fresh();
    h.addBook('LMS2', '2026-27'); // sub is allowlisted for LMS1 only
    assert.equal(grant(h, { campus: 'LMS2' }).success, true, 'LMS2 grant is written');
    assert.equal(submit(h, { campus: 'LMS2' }, 'sub-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(submit(h, {}, 'sub-token').error, 'FORBIDDEN_ROLE', 'LMS2 grant gives nothing on LMS1');
    assert.equal(grant(h, { campus: 'LMS1' }).success, true);
    assert.equal(submit(h, { campus: 'LMS2' }, 'sub-token').error, 'FORBIDDEN_CAMPUS', 'LMS1 grant gives nothing on LMS2');
    assert.equal(submit(h, {}, 'sub-token').success, true);
  });

  t.test('report.submit is the only action that declares substitute access', () => {
    const h = fresh();
    const acts = h.ctx.officeAllActions_();
    assert.deepEqual(Object.keys(acts).filter((k) => acts[k].substitute), ['report.submit']);
  });

  t.test('grant validation and roles', () => {
    const h = fresh();
    assert.equal(grant(h, { from_date: '2026-10-22', to_date: '2026-10-21' }).error, 'BAD_RANGE');
    assert.equal(grant(h, { email: 'nope' }).error, 'BAD_EMAIL');
    assert.equal(grant(h, { from_date: '2026-13-01' }).error, 'BAD_DATE');
    assert.equal(h.call('substitute.grant', { id: 'x', campus: 'LMS1', email: 'a@b.org', from_date: '2026-10-21', to_date: '2026-10-21' }, 'fh-token').error, 'FORBIDDEN_ROLE');
    assert.equal(grant(h, { id: 'same' }).success, true);
    assert.equal(grant(h, { id: 'same' }).duplicate, true);
  });

  t.test('cash differing from day book is returned in cashMismatch and does not block', () => {
    const h = fresh();
    h.call('daybook.add', { id: 'e1', campus: 'LMS1', entry_date: '2026-10-21', account: 'cash:LMS1', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 5000 }, 'clerk-token');
    assert.equal(submit(h, { cash: { petty: 100, fee: 5000, other: 0 } }).success, true);
    assert.deepEqual(get(h).cashMismatch, [{ bucket: 'petty', report_paise: 100, daybook_paise: 0 }]);
    h.setNow(new Date('2026-10-21T10:05:00Z'));
    submit(h, { cash: { petty: 0, fee: 5000, other: 0 } });
    assert.deepEqual(get(h).cashMismatch, []);
    assert.deepEqual(get(h, '2026-10-19').cashMismatch, []);
  });

  t.test('report.submit for a closed day returns DAY_CLOSED', () => {
    const h = fresh();
    assert.equal(h.call('day.close', { id: 'c1', campus: 'LMS1', close_date: '2026-10-20' }, 'fh-token').success, true);
    const r = submit(h, { report_date: '2026-10-20' });
    assert.equal(r.code, 'DAY_CLOSED');
    assert.equal(h.ctx.officeRows_(h.book, 'Reports').length, 0);
  });

  t.test('validation: cash, footfall, dates, hourly, campus', () => {
    const h = fresh();
    [{ petty: -1, fee: 0, other: 0 }, { petty: 0.5, fee: 0, other: 0 }, { petty: '5', fee: 0, other: 0 }, { petty: 0, fee: 0 }, null].forEach((c) => assert.equal(submit(h, { cash: c }).error, 'BAD_AMOUNT', JSON.stringify(c)));
    assert.equal(submit(h, { cash: { petty: 0, fee: 0, other: 0 } }).success, true, 'zero is allowed');
    [-1, 1.5, '3', null].forEach((f) => assert.equal(submit(h, { footfall: f }).error, 'BAD_FOOTFALL'));
    assert.equal(submit(h, { report_date: '2026-02-30' }).error, 'BAD_DATE');
    assert.equal(submit(h, { report_date: '2026-10-22' }).error, 'FUTURE_DATE');
    assert.equal(submit(h, { hourly: 'x' }).error, 'BAD_HOURLY');
    assert.equal(submit(h, { hourly: [{ hour: '9', text: 5 }] }).error, 'BAD_HOURLY');
    assert.equal(submit(h, { id: '' }).error, 'MISSING_ID');
    assert.equal(submit(h, { campus: 'LMS2' }).error, 'FORBIDDEN_CAMPUS');
  });
};
