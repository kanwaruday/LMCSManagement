// Needs-attention helpers and the opening-balance payload (office/js). Standalone: node tests/office/test-attention.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const { describeEntry, explainCode } = await import('../../office/js/attention.js');
  const { openingPayload } = await import('../../office/js/close.js');
  assert.strictEqual(describeEntry({ action: 'daybook.add', data: { amount_paise: 120000, entry_date: '2026-10-21' } }), 'Day book entry ₹1,200.00 on 21/10/2026');
  assert.strictEqual(describeEntry({ action: 'deposit.add', data: { amount_paise: 500000 } }), 'Deposit ₹5,000.00');
  assert.strictEqual(describeEntry({ action: 'report.submit', data: { report_date: '2026-10-21' } }), 'Daily report 21/10/2026');
  assert.strictEqual(describeEntry({ action: 'file.upload', data: {} }), 'Slip upload');
  assert.strictEqual(describeEntry({ action: 'day.close', data: { close_date: '2026-10-20' } }), 'Day close 20/10/2026');
  assert.strictEqual(describeEntry({ action: 'daybook.add' }), 'Day book entry');
  assert.strictEqual(describeEntry({ action: 'weird.thing' }), 'weird.thing');
  for (const c of ['DAY_CLOSED', 'FILE_MISSING', 'LEGS_MISSING', 'INSUFFICIENT_CASH', 'OPENING_LOCKED', 'FORBIDDEN_CAMPUS', 'FORBIDDEN_ROLE', 'BAD_AMOUNT', 'BAD_DATE', 'CANNOT_CLOSE_TODAY', 'ALREADY_REVERSED', 'ALREADY_SIGNED'])
    assert.notStrictEqual(explainCode(c), c, c);
  assert.ok(explainCode('OPENING_LOCKED').includes('locked because day book entries already exist'));
  assert.strictEqual(explainCode('SOMETHING_ELSE'), 'SOMETHING_ELSE');
  assert.strictEqual(explainCode(null), 'The server refused it.');
  console.log('  ok  - describeEntry and explainCode');

  const r = openingPayload('LMS1', ['1,000', '', '0', '₹2500.50', '10']);
  assert.deepStrictEqual(r, { ok: true, data: { campus: 'LMS1', balances: [
    { mode: 'cash', bucket: 'petty', amount_paise: 100000 }, { mode: 'cash', bucket: 'fee', amount_paise: 0 }, { mode: 'cash', bucket: 'other', amount_paise: 0 },
    { mode: 'bank', amount_paise: 250050 }, { mode: 'upi', amount_paise: 1000 }] } });
  assert.strictEqual(openingPayload('LMS1', []).ok, true); // all blank = all zero
  for (const bad of ['-5', 'abc', '1.234', '0.1+0.2']) assert.strictEqual(openingPayload('LMS1', [bad]).ok, false, bad);
  console.log('  ok  - openingPayload: five balances, blank/0 allowed, bad input rejected');
})().catch((e) => { console.error(e); process.exit(1); });
