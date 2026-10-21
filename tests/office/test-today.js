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

  t.test('day close targets the oldest open past day, then the next', () => {
    const h = fresh(); fee(h, 100, '2026-10-18'); fee(h, 100, '2026-10-20');
    const close = (d) => h.call('day.close', { id: 'c' + d, campus: 'LMS1', close_date: d }, 'fh-token');
    assert.deepEqual(ids(get(h, 'fh-token')).filter((i) => /^close:/.test(i)), ['close:2026-10-18']);
    assert.equal(close('2026-10-18').success, true);
    assert.deepEqual(ids(get(h, 'fh-token')).filter((i) => /^close:/.test(i)), ['close:2026-10-20']);
  });

  t.test('window crossing 1 April with no previous-year book returns normal tasks, no waiting task', () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.setNow(new Date('2026-04-03T10:00:00Z'));
    const r = get(h);
    assert.equal(r.success, true);
    assert.deepEqual(ids(r), ['report:2026-04-03']);
    assert.deepEqual(ids(get(h, 'fh-token')), []);
  });

  t.test('campus required and enforced', () => {
    const h = fresh();
    assert.equal(h.call('today.get', {}, 'clerk-token').error, 'MISSING_CAMPUS');
    assert.equal(h.call('today.get', { campus: 'LMS2' }, 'clerk-token').error, 'FORBIDDEN_CAMPUS');
  });
  // I7 / R41: one request opens each book once and reads each tab once (per-request memo).
  t.test('today.get opens each book once and reads each tab once', () => {
    const h = fresh();
    for (let d = 14; d <= 20; d++) fee(h, 100, '2026-10-' + d);
    get(h, 'owner-token');
    const before = Object.assign({}, h.counter);
    const r = get(h, 'owner-token');
    assert.equal(r.success, true);
    assert.ok(h.counter.open - before.open <= 2, 'opens: ' + (h.counter.open - before.open));
    assert.ok(h.counter.read - before.read <= 14, 'reads: ' + (h.counter.read - before.read));
  });

  t.test('memo never serves stale rows: a write in the same request is seen, and the next request reads fresh', () => {
    const h = fresh(); fee(h, 5000, '2026-10-21');
    // deposit.add reads DayBook (balance), then writes Deposits + legs; a second deposit then sees the legs.
    assert.equal(h.call('deposit.add', { id: 'd1', campus: 'LMS1', covers_date: '2026-10-21', amount_paise: 5000, bank_ref: 'R', file_id: 'slip' }, 'clerk-token').success, true);
    assert.equal(h.call('deposit.add', { id: 'd2', campus: 'LMS1', covers_date: '2026-10-21', amount_paise: 1, bank_ref: 'R', file_id: 'slip' }, 'clerk-token').code, 'INSUFFICIENT_CASH');
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Reports', { id: 'x', campus: 'LMS1', report_date: '2026-10-21', json: '{}', late: 'false' });
    assert.equal(one(get(h), 'report:2026-10-21').status, 'done', 'a row written outside a request is read by the next one');
    assert.strictEqual(h.ctx.OFFICE_MEMO, null, 'memo is off outside a request');
  });
  // M7 / R41: cash older than the 7-day window still surfaces, as one task.
  t.test('one "older undeposited cash" task for days older than 7 days in this FY', () => {
    const h = fresh();
    fee(h, 100, '2026-10-01'); fee(h, 100, '2026-10-05'); fee(h, 100, '2026-10-10');
    h.call('deposit.add', { id: 'dold', campus: 'LMS1', covers_date: '2026-10-10', amount_paise: 100, bank_ref: 'R', file_id: 'slip' }, 'clerk-token');
    const t1 = one(get(h), 'deposit:older');
    assert.deepEqual(JSON.parse(JSON.stringify(t1)), { id: 'deposit:older', title: 'Fee cash not fully deposited for 2 older days, oldest 2026-10-01', due: '2026-10-02', status: 'overdue', action: 'deposits' });
    const g = fresh(); fee(g, 100, '2026-10-20');
    assert.ok(!ids(get(g)).includes('deposit:older'), 'nothing older: no task');
    assert.ok(!ids(get(g, 'fh-token')).includes('deposit:older'), 'Finance Head does not get deposit tasks');
  });
  // R43: the older-cash task is one pass over DayBook + Deposits, not one recon per day.
  t.test('older undeposited cash over ~300 days matches per-day recon, without a recon per day, in under 1 s', () => {
    const h = boot(fixture, { extraSource: 'var RECON_CALLS = 0, reconOrig_ = officeReconGet_; officeReconGet_ = function (c, d) { RECON_CALLS++; return reconOrig_(c, d); };' });
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26');
    h.setNow(new Date('2027-02-20T10:00:00Z'));
    h.call('file.upload', { id: 'slip', campus: 'LMS1', category: 'deposit_proof', mime: 'application/pdf', base64: PDF, name: 's.pdf' }, 'clerk-token');
    const dates = []; for (let d = new Date('2026-04-01T00:00:00Z'); d < new Date('2027-02-20T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
    let k = 0; const add = (date, extra) => assert.equal(h.call('daybook.add', Object.assign({ id: 'b' + (++k), campus: 'LMS1', entry_date: date, direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 1000 }, extra), 'clerk-token').success, true);
    dates.forEach((date, i) => {
      add(date);
      if (i % 5 === 0) add(date, { mode: 'upi', bucket: '' }); // not cash
      if (i % 7 === 0) h.call('deposit.add', { id: 'dp' + i, campus: 'LMS1', covers_date: date, amount_paise: 1000, bank_ref: 'R' + i, file_id: 'slip' }, 'clerk-token');
      if (i % 11 === 0) h.call('deposit.add', { id: 'dh' + i, campus: 'LMS1', covers_date: date, amount_paise: 500, bank_ref: 'H' + i, file_id: 'slip' }, 'clerk-token'); // part-deposited
      if (i % 13 === 0) assert.equal(h.call('daybook.reverse', { id: 'rv' + i, campus: 'LMS1', reverses: 'b' + k }, 'clerk-token').success, true, 'reversed in full');
    });
    assert.ok(dates.length >= 300, dates.length);
    const cutoff = '2027-02-13';
    const expected = dates.filter((d) => d < cutoff).filter((d) => { const r = h.call('recon.get', { campus: 'LMS1', date: d }, 'clerk-token'); return r.deposited < r.daybook_fee_cash; });
    h.run('RECON_CALLS = 0');
    const t0 = Date.now(); const r = get(h); const ms = Date.now() - t0;
    assert.equal(r.success, true);
    assert.deepEqual(JSON.parse(JSON.stringify(one(r, 'deposit:older'))), { id: 'deposit:older', title: 'Fee cash not fully deposited for ' + expected.length + ' older days, oldest ' + expected[0], due: new Date(Date.parse(expected[0] + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10), status: 'overdue', action: 'deposits' });
    assert.ok(expected.length > 100 && expected.length < dates.length - 30, 'mix of short and settled days: ' + expected.length);
    assert.ok(h.run('RECON_CALLS') <= 7, 'recon only for the 7-day window, got ' + h.run('RECON_CALLS'));
    assert.ok(ms < 1000, 'today.get took ' + ms + ' ms');
  });
};
