// Pure helpers of the Day Book and Daily Report screens. Standalone: node tests/office/test-daybook-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const { mergeQueued, canReverse, entryCategories, inflightGuard, entryFromForm, fyEnd, todayIst } = await import('../../office/js/daybook.js');
  const { reportDraftToPayload, mismatchLines, reportQueueState } = await import('../../office/js/report.js');
  const { createOutbox } = await import('../../office/js/outbox.js');
  const row = (id, extra = {}) => ({ id, entry_date: '2026-10-21', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 500, reverses: '', ...extra });
  const q = (id, status, data, action = 'daybook.add') => ({ id, seq: 1, action, status, code: null, error: status === 'attention' ? 'DAY_CLOSED' : null, data });
  const cats = [{ id: 'fee_collection', label: 'Fee collection', direction: 'IN' }, { id: 'petty_expense', label: 'Petty', direction: 'OUT' }];

  // mergeQueued
  const rows = [row('a'), row('b'), row('rev-b', { direction: 'OUT', reverses: 'b', entry_date: '2026-10-22' }), row('other', { entry_date: '2026-10-20' })];
  let m = mergeQueued(rows, [q('n1', 'waiting', { entry_date: '2026-10-21', amount_paise: 7 }), q('n2', 'attention', { entry_date: '2026-10-21' }), q('n3', 'waiting', { entry_date: '2026-10-20' }), q('r1', 'waiting', { reverses: 'a' }, 'daybook.reverse')], '2026-10-21');
  assert.deepStrictEqual(m.map((x) => x.id), ['a', 'b', 'n1', 'n2']); // only that date, synced first, queued after in order
  assert.deepStrictEqual(m.map((x) => x.synced), [true, true, false, false]);
  assert.ok(m[3].error.startsWith('That day is closed'));
  assert.strictEqual(m[1].reversed, true); // reversal row dated later still marks the original
  assert.strictEqual(m[0].reversalQueued, true);
  assert.deepStrictEqual(m.map(canReverse), [false, false, false, false]);
  assert.strictEqual(canReverse(mergeQueued([row('z')], [], '2026-10-21')[0]), true);
  assert.strictEqual(canReverse({ ...row('r'), synced: true, reverses: 'x' }), false);
  // R37: deposit legs never get a Reverse button, and their categories are not offered in the form
  assert.strictEqual(canReverse(mergeQueued([row('dep1:out', { category: 'deposit_cash_out' })], [], '2026-10-21')[0]), false);
  assert.strictEqual(canReverse(mergeQueued([row('dep1:in', { mode: 'bank', bucket: '', category: 'deposit_bank_in' })], [], '2026-10-21')[0]), false);
  assert.deepStrictEqual(entryCategories([...cats, { id: 'deposit_cash_out' }, { id: 'deposit_bank_in' }]).map((c) => c.id), ['fee_collection', 'petty_expense']);
  // a queued entry that the server already has (flushed between reads) is not shown twice
  assert.strictEqual(mergeQueued([row('n1')], [q('n1', 'waiting', { entry_date: '2026-10-21' })], '2026-10-21').length, 1);
  console.log('  ok  - mergeQueued marks unsynced, dates, reversals');

  // entryFromForm
  const f = { campus: 'LMS1', date: '2026-10-21', category: 'petty_expense', mode: 'cash', bucket: 'petty', amount: '1,234.50', payee: ' Raju ', narration: '' };
  let r = entryFromForm(f, cats);
  assert.ok(r.ok); assert.strictEqual(r.data.amount_paise, 123450); assert.strictEqual(r.data.direction, 'OUT'); assert.strictEqual(r.data.payee, 'Raju');
  r = entryFromForm({ ...f, mode: 'upi', bucket: 'petty' }, cats); assert.strictEqual(r.data.bucket, '');
  assert.ok(entryFromForm({ ...f, mode: 'cash', bucket: '' }, cats).errors.bucket);
  for (const bad of ['0', '-5', '0.1+0.2', '', '1.234']) assert.ok(entryFromForm({ ...f, amount: bad }, cats).errors.amount, bad);
  assert.ok(entryFromForm({ ...f, category: 'nope' }, cats).errors.category);
  console.log('  ok  - entryFromForm derives direction, bucket only for cash, rejects bad amounts');

  assert.strictEqual(fyEnd('2026-10-21'), '2027-03-31'); assert.strictEqual(fyEnd('2027-02-01'), '2027-03-31'); assert.strictEqual(fyEnd('2026-04-01'), '2027-03-31');
  assert.strictEqual(todayIst(new Date('2026-10-21T19:00:00Z')), '2026-10-22'); // 00:30 IST next day
  console.log('  ok  - fyEnd and IST date');

  // reportDraftToPayload
  const rep = { campus: 'LMS1', report_date: '2026-10-21', hourly: ['9: opened', '  ', '10: calls'], footfall: '12', feedback_pos: ' good ', feedback_neg: '', leave_status: 'none', external_docs: '', cash: { petty: '', fee: '1,234.50', other: '0' } };
  let p = reportDraftToPayload(rep);
  assert.ok(p.ok);
  assert.deepStrictEqual(p.payload.cash, { petty: 0, fee: 123450, other: 0 });
  assert.deepStrictEqual(p.payload.hourly, [{ text: '9: opened' }, { text: '10: calls' }]);
  assert.strictEqual(p.payload.footfall, 12); assert.strictEqual(p.payload.feedback_pos, 'good');
  p = reportDraftToPayload({ ...rep, cash: { petty: '1.234', fee: '-1', other: '0' }, footfall: '1.5' });
  assert.ok(!p.ok); assert.ok(p.errors.cash_petty && p.errors.cash_fee && p.errors.footfall && !p.errors.cash_other);
  assert.deepStrictEqual(mismatchLines([{ bucket: 'fee', report_paise: 100000, daybook_paise: 50000 }]), ['Fee cash: report ₹1,000.00, day book ₹500.00']);
  console.log('  ok  - reportDraftToPayload converts rupees to paise and hourly rows; mismatch in plain words');

  // reportQueueState
  const sub = (id, status, date, seq = 1) => ({ id, seq, action: 'report.submit', status, error: status === 'attention' ? 'DAY_CLOSED' : null, data: { report_date: date } });
  assert.strictEqual(reportQueueState([sub('r1', 'waiting', '2026-10-21')], '2026-10-21', null, 'r1').state, 'waiting');
  assert.deepStrictEqual(reportQueueState([sub('r1', 'attention', '2026-10-21')], '2026-10-21', null, null), { state: 'attention', id: 'r1', error: (await import('../../office/js/codes.js')).CODES.DAY_CLOSED });
  assert.strictEqual(reportQueueState([sub('r1', 'waiting', '2026-10-20')], '2026-10-21', null, null).state, 'none'); // other date
  assert.strictEqual(reportQueueState([sub('r1', 'attention', '2026-10-21', 1), sub('r2', 'waiting', '2026-10-21', 2)], '2026-10-21').state, 'waiting'); // newest wins
  assert.strictEqual(reportQueueState([], '2026-10-21', { id: 'r1' }, 'r1').state, 'synced');
  assert.strictEqual(reportQueueState([], '2026-10-21', { id: 'someone-else' }, 'r1').state, 'missing'); // not queued, not on server: no endless Waiting
  assert.strictEqual(reportQueueState([], '2026-10-21', null, 'r1').state, 'missing');
  assert.strictEqual(reportQueueState([], '2026-10-21', { id: 'x' }, null).state, 'none');
  console.log('  ok  - reportQueueState: waiting, attention, synced, missing, none');

  // inflightGuard (double-tap on Reverse)
  const g = inflightGuard(); let calls = 0, release;
  const slow = () => new Promise((res) => { calls++; release = res; });
  const first = g('a', slow); const second = await g('a', slow);
  assert.strictEqual(second, false); assert.strictEqual(calls, 1);
  release(); assert.strictEqual(await first, true);
  assert.strictEqual(await g('a', async () => { calls++; }), true); assert.strictEqual(calls, 2); // free again after it resolves
  console.log('  ok  - inflightGuard ignores a second call while the first is pending');

  // outbox.entries lists waiting and attention entries for the screens
  const m2 = new Map(); const store = { put: async (e) => { m2.set(e.id, e); }, getAll: async () => [...m2.values()], delete: async (id) => { m2.delete(id); } };
  const ob = createOutbox({ store, api: { write: async () => ({ success: false, network: true }) }, newId: (() => { let n = 0; return () => 'e' + (++n); })() });
  await ob.enqueue('daybook.add', { entry_date: '2026-10-21' }); await ob.enqueue('report.submit', {});
  assert.deepStrictEqual((await ob.entries()).map((e) => e.id), ['e1', 'e2']);
  console.log('  ok  - outbox.entries');
})().catch((e) => { console.log('  FAIL -', e.message); process.exit(1); });
