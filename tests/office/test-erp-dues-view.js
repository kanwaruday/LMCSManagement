// Pure helpers of the ERP fee dues window (office/js/erp-dues.js). Standalone: node tests/office/test-erp-dues-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const D = await import('../../office/js/erp-dues.js');
  const ok = (n) => console.log('  ok  - ' + n);
  const row = (name, cls, section, pending) => ({ enrollNo: 'E' + name.length, name, class: cls, section, receivable: pending, received: 0, concession: 0, pending, heads: [] });
  const r = { success: true, what: 'dues', campus: 'LMS4', configured: true, missing: [], rows: [
    row('Test Asha', '10', 'A', 500), row('Test Bina', '7', 'A', 12000), row('Test Chetan', '7', 'A', 12000), row('Test Dev', '2', 'B', 0), row('', '2', 'B', 50)] };
  const d = D.normalize(r);
  assert.strictEqual(d.count, 3, 'zero dues and nameless rows are left out');
  assert.strictEqual(d.total, 24500);
  assert.deepStrictEqual(d.classes.map((c) => [c.key, c.count, c.total]), [['7 A', 2, 24000], ['10 A', 1, 500]], 'classes in number order');
  ok('normalize: totals from the rows, classes in order');
  assert.deepStrictEqual(D.pick(d, '', '').map((s) => s.name), ['Test Bina', 'Test Chetan', 'Test Asha'], 'largest due first, then name');
  assert.deepStrictEqual(D.pick(d, '10 A', '').map((s) => s.name), ['Test Asha']);
  assert.deepStrictEqual(D.pick(d, '', 'chet').map((s) => s.name), ['Test Chetan']);
  ok('pick: class, search, order');
  assert.strictEqual(D.inr(124500), '₹1,24,500');
  assert.strictEqual(D.summaryLine(d), '₹24,500 बकाया · due from 3 students');
  assert.strictEqual(D.summaryLine(D.normalize({ success: true, configured: true, missing: [], rows: [] })), 'कोई बकाया नहीं · No fees due');
  assert.strictEqual(D.summaryLine(D.normalize({ success: true, configured: false, rows: [], note: "ERP data for LMS 4 isn't connected yet." })), "ERP data for LMS 4 isn't connected yet.");
  assert.strictEqual(D.summaryLine(D.normalize({ success: true, configured: true, rows: [], missing: ['Dues'] })), "Fee dues haven't come in from the ERP yet.");
  assert.strictEqual(D.failLine({ success: false, code: 'ERP_NOT_ALLOWED', error: 'Not for you.' }), 'Not for you.');
  ok('summary lines: total, none due, not connected, tab missing, refused');
  assert.strictEqual(D.canSeeDues({ role: 'FeeClerk' }, ''), true);
  assert.strictEqual(D.canSeeDues({ role: 'Teacher,Principal' }, ''), true);
  assert.strictEqual(D.canSeeDues({ role: 'Owner' }, ''), false, 'the Owner has no school to default to');
  assert.strictEqual(D.canSeeDues({ role: 'Owner' }, 'LMS4'), true, 'the Owner viewing a school');
  assert.strictEqual(D.canSeeDues({ role: 'Coordinator' }, 'LMS4'), false);
  ok('canSeeDues');
  assert.ok(D.readUrl('t k', '').endsWith('?action=erpread&what=dues&idToken=t%20k'));
  assert.ok(D.readUrl('t', 'LMS4').endsWith('&campus=LMS4') && !D.readUrl('t', 'LMS4').includes('asCampus'));
  ok('readUrl: erpread dues; the viewed school as campus, never asCampus');
  console.log('erp dues view: ok');
})().catch((e) => { console.error(e); process.exit(1); });
