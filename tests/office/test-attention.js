// Needs-attention helpers and the opening-balance payload (office/js). Standalone: node tests/office/test-attention.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const { describeEntry, explainCode, entryReason } = await import('../../office/js/attention.js');
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
  assert.ok(entryReason({ status: 'attention', code: null, error: 'OPENING_LOCKED' }).includes('locked because day book entries already exist'));
  assert.strictEqual(entryReason({ code: 'DAY_CLOSED', error: 'x' }), explainCode('DAY_CLOSED'));
  console.log('  ok  - describeEntry, explainCode, entryReason (uncoded error)');

  const r = openingPayload('LMS1', ['1,000', '', '0', '₹2500.50', '10']);
  assert.deepStrictEqual(r, { ok: true, data: { campus: 'LMS1', balances: [
    { mode: 'cash', bucket: 'petty', amount_paise: 100000 }, { mode: 'cash', bucket: 'fee', amount_paise: 0 }, { mode: 'cash', bucket: 'other', amount_paise: 0 },
    { mode: 'bank', amount_paise: 250050 }, { mode: 'upi', amount_paise: 1000 }] } });
  assert.strictEqual(openingPayload('LMS1', []).ok, true); // all blank = all zero
  for (const bad of ['-5', 'abc', '1.234', '0.1+0.2']) assert.strictEqual(openingPayload('LMS1', [bad]).ok, false, bad);
  // Every plain ALL_CAPS literal in the office backend is explained, or listed here as never reaching a user.
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, '../../apps-script');
  const { CODES } = await import('../../office/js/codes.js');
  const IGNORE = /^OFFICE_/; // Script Property names
  const used = new Set();
  fs.readdirSync(dir).filter((f) => /^office.*\.gs$/.test(f)).forEach((f) => (fs.readFileSync(path.join(dir, f), 'utf8').match(/'[A-Z][A-Z_]{5,}'/g) || []).forEach((m) => used.add(m.slice(1, -1))));
  assert.ok(used.has('OPENING_LOCKED') && used.size > 20, 'scan found the codes');
  const missing = [...used].filter((c) => !IGNORE.test(c) && !CODES[c]);
  assert.deepStrictEqual(missing, [], 'unexplained backend codes: ' + missing);
  console.log('  ok  - every backend error code has plain words');
  console.log('  ok  - openingPayload: five balances, blank/0 allowed, bad input rejected');
})().catch((e) => { console.error(e); process.exit(1); });
