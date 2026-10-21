// Pure helpers of the Deposits and Close screens. Standalone: node tests/office/test-deposits-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const { resizeDims, pdfTooBig, PDF_MAX_BYTES } = await import('../../office/js/image.js');
  const { canRenderMime, depositFromForm, queueNotes, reconLines, mergeDeposits } = await import('../../office/js/deposits.js');
  const { closeBlockedReason } = await import('../../office/js/close.js');

  assert.deepStrictEqual(resizeDims(4000, 3000, 1600), { w: 1600, h: 1200 });
  assert.deepStrictEqual(resizeDims(3000, 4000, 1600), { w: 1200, h: 1600 });
  assert.deepStrictEqual(resizeDims(800, 600, 1600), { w: 800, h: 600 }); // never upscale
  assert.deepStrictEqual(resizeDims(1601, 1, 1600), { w: 1600, h: 1 }); // never zero
  console.log('  ok  - resizeDims');

  assert.strictEqual(pdfTooBig(PDF_MAX_BYTES), false);
  assert.strictEqual(pdfTooBig(PDF_MAX_BYTES + 1), true);
  console.log('  ok  - pdf size check');

  ['image/jpeg', 'image/png', 'application/pdf'].forEach((m) => assert.strictEqual(canRenderMime(m), true));
  ['text/html', 'image/svg+xml', 'image/gif', '', undefined, 'IMAGE/JPEG '].forEach((m) => assert.strictEqual(canRenderMime(m), false));
  console.log('  ok  - render mime allowlist');

  assert.strictEqual(closeBlockedReason({ waiting: 2, isPast: true }).blocked, true);
  assert.match(closeBlockedReason({ waiting: 2, isPast: true }).message, /2 entries on this device are not synced yet.*other devices/);
  assert.strictEqual(closeBlockedReason({ waiting: 1 }).message.startsWith('1 entry on this device is not synced yet'), true);
  let w = closeBlockedReason({ waiting: 0, unsigned: 1 });
  assert.strictEqual(w.blocked, false); assert.match(w.message, /1 deposit/);
  assert.strictEqual(closeBlockedReason({ waiting: 0, unsigned: 0, isPast: false }).blocked, true); // today/future
  assert.deepStrictEqual(closeBlockedReason({ waiting: 0, unsigned: 0, attention: 0, isPast: true }), { blocked: false, message: '' });
  assert.strictEqual(closeBlockedReason({ waiting: 0, attention: 1, isPast: true }).blocked, false);
  assert.match(closeBlockedReason({ waiting: 0, attention: 1, isPast: true }).message, /needs attention/);
  console.log('  ok  - closeBlockedReason');

  const d = depositFromForm({ campus: 'LMS1', covers_date: '2026-10-20', amount: '1,500.50', bank_ref: ' UTR1 ', hasFile: true });
  assert.strictEqual(d.ok, true); assert.strictEqual(d.data.amount_paise, 150050); assert.strictEqual(d.data.bank_ref, 'UTR1');
  const bad = depositFromForm({ campus: 'LMS1', covers_date: '', amount: '0', bank_ref: '', hasFile: false });
  assert.deepStrictEqual(Object.keys(bad.errors).sort(), ['amount', 'bank_ref', 'covers_date', 'file']);
  console.log('  ok  - depositFromForm');

  const e = (action, status, code, data = {}) => ({ id: action + status, seq: 1, action, status, code, error: code, data });
  const notes = queueNotes([e('deposit.add', 'attention', 'LEGS_MISSING', { covers_date: '2026-10-20' }), e('deposit.add', 'attention', 'FILE_MISSING'), e('deposit.add', 'waiting', null), e('daybook.add', 'waiting', null)]);
  assert.strictEqual(notes.length, 3);
  assert.match(notes[0].text, /closed/i); assert.match(notes[1].text, /photo|file/i); assert.strictEqual(notes[2].bad, false);
  console.log('  ok  - queueNotes');

  const srv = [{ id: 'a', covers_date: '2026-10-20', amount_paise: 1, bank_ref: 'x', file_id: 'f', signed: false }];
  const md = mergeDeposits(srv, [{ id: 'a', action: 'deposit.add', status: 'waiting', data: { covers_date: '2026-10-20' } }, { id: 'q', action: 'deposit.add', status: 'attention', code: 'FILE_MISSING', data: { covers_date: '2026-10-20', amount_paise: 2, bank_ref: 'y', file_id: 'g' } }, { id: 'o', action: 'deposit.add', status: 'waiting', data: { covers_date: '2026-10-19' } }], '2026-10-20');
  assert.deepStrictEqual(md.map((x) => [x.id, x.queued]), [['a', false], ['q', true]]); // synced not doubled, other dates skipped
  assert.match(md[1].error, /photo/);
  console.log('  ok  - mergeDeposits');

  const L = reconLines({ erp: null, daybook_fee_cash: 100000, deposited: 90000, unsigned: [], overdue: true, differences: [{ a: 'daybook_fee_cash', b: 'deposited', delta_paise: 10000 }] });
  assert.ok(L.some((x) => x.includes('₹1,000.00')) && L.some((x) => /overdue/i.test(x)) && L.some((x) => x.includes('₹100.00')));
  console.log('  ok  - reconLines');
})().catch((err) => { console.error(err); process.exit(1); });
