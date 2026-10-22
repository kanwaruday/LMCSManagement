// Pure helpers of the Today screen. Standalone: node tests/office/test-today-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const T = await import('../../office/js/today.js');
  const ok = (n) => console.log('  ok  - ' + n);
  const list = [
    { status: '', interviewAt: '' }, { status: '', interviewAt: '2026-10-24 10:00' }, { status: '' },
    { status: 'Hiring Approved', docsMissing: ['PAN'] }, { status: 'Hiring Approved', docsMissing: [] }, { status: 'Rejected' },
  ];
  assert.deepStrictEqual(T.hiringCounts(list), { needSlot: 2, docs: 1 }); ok('hiringCounts');
  assert.deepStrictEqual(T.hiringCounts(undefined), { needSlot: 0, docs: 0 }); ok('hiringCounts empty');
  assert.strictEqual(T.hiringLabel({ needSlot: 2, docs: 1 }), 'Hiring · 2 need a slot · 1 documents to chase');
  assert.strictEqual(T.hiringLabel({ needSlot: 0, docs: 0 }), 'Hiring'); ok('hiringLabel');
  const link = { textContent: 'Hiring' };
  await T.showHiringCounts(link, async () => ({ json: async () => ({ success: true, applicants: list }) }), 'u', 't');
  assert.strictEqual(link.textContent, 'Hiring · 2 need a slot · 1 documents to chase'); ok('showHiringCounts sets the link');
  const l2 = { textContent: 'Hiring' };
  await T.showHiringCounts(l2, async () => { throw new Error('offline'); }, 'u', 't');
  await T.showHiringCounts(l2, async () => ({ json: async () => ({ success: false, error: 'Not authorized' }) }), 'u', 't');
  assert.strictEqual(l2.textContent, 'Hiring'); ok('offline or refused leaves the plain link');
})().catch((e) => { console.error(e); process.exit(1); });
